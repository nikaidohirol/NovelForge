"""越界检测器（聚焦点 B）：直接匹配 + 语义匹配（embedding 余弦）双机制。

工程闭环：违规记录持久化 → 重试上限 → 强制 silence fallback。
每次 enforce 产生独立 trace span（boundary.check / boundary.regenerate）。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from config.settings import PROJECT_ROOT, get_settings
from src.boundary.claim_extractor import ClaimExtractor
from src.memory.vector_store import cosine, get_embedding_function
from src.models.claim import BoundaryViolation, Claim
from src.models.character import CharacterCard
from src.observability.trace import get_tracer
from src.utils.llm import call_llm
from src.utils.logger import get_logger

logger = get_logger(__name__)


def _normalize(text: str) -> str:
    """匹配用归一化：去标点 + 去中文虚词/疑问词（的/是/谁/什么…），
    使『地下组织的首领是谁』与『地下组织首领伊芙』可对齐。"""
    text = re.sub(r"[\s，。！？、,.!?;；:：\"'（）()「」《》·—-]+", "", text or "").lower()
    text = re.sub(r"什么|哪里|哪些|怎么|如何|为什么|多久|几点", "", text)
    return re.sub(r"[的了是吗呢吧啊谁呀呐么]", "", text)


class BoundaryGuard:
    def __init__(self, semantic_threshold: float | None = None, max_retry: int | None = None):
        s = get_settings()
        self.semantic_threshold = (
            s.boundary_semantic_threshold if semantic_threshold is None else semantic_threshold
        )
        self.max_retry = s.boundary_max_retry if max_retry is None else max_retry
        self.extractor = ClaimExtractor()
        self.embed_fn = get_embedding_function()
        self._fact_emb_cache: dict[str, list[list[float]]] = {}

    # ---- embedding 缓存：每张卡只算一次 ----
    def _fact_embeddings(self, card: CharacterCard) -> list[list[float]]:
        key = card.name
        if key not in self._fact_emb_cache:
            facts = card.unknown_facts or [""]
            self._fact_emb_cache[key] = self.embed_fn.embed(facts)
        return self._fact_emb_cache[key]

    # ---- 检查 ----
    def check(self, action: dict, card: CharacterCard, turn: int = 0) -> tuple[dict, list[BoundaryViolation]]:
        tracer = get_tracer()
        violations: list[BoundaryViolation] = []
        with tracer.trace("boundary.check", tags=["boundary"], character=card.name, turn=turn) as span:
            claims = self.extractor.extract(action.get("content", ""))
            fact_embs = self._fact_embeddings(card)
            facts = card.unknown_facts or []
            for claim in claims:
                claim_text = f"{claim.subject}{claim.relation}{claim.object}"
                matched = self._direct_match(claim, facts)
                vtype = "direct_match" if matched else None
                if not matched and facts:
                    emb = self.embed_fn.embed([claim_text])[0]
                    best_i = max(range(len(facts)), key=lambda i: cosine(emb, fact_embs[i]))
                    if cosine(emb, fact_embs[best_i]) >= self.semantic_threshold:
                        matched, vtype = facts[best_i], "semantic_match"
                if matched:
                    violation = BoundaryViolation(
                        turn=turn,
                        character=card.name,
                        claim=claim,
                        violation_type=vtype or "direct_match",
                        matched_unknown_fact=matched if isinstance(matched, str) else str(matched),
                    )
                    violations.append(violation)
            span.meta["claims"] = len(claims)
            span.meta["violations"] = len(violations)
            span.set_output(f"claims={len(claims)}, violations={len(violations)}")
        if violations:
            self._log_violations(violations)
        return action, violations

    def _direct_match(self, claim: Claim, unknown_facts: list[str]) -> str | None:
        """归一化后的子串双向匹配。返回命中的 fact 或 None。"""
        claim_text = _normalize(f"{claim.subject}{claim.relation}{claim.object}")
        if len(claim_text) < 2:
            return None
        for fact in unknown_facts or []:
            nf = _normalize(fact)
            if not nf:
                continue
            if nf in claim_text or claim_text in nf:
                return fact
        return None

    # ---- 拦截与重生成闭环 ----
    def enforce(self, action: dict, card: CharacterCard, turn: int = 0,
                max_retry: int | None = None) -> dict:
        tracer = get_tracer()
        max_retry = self.max_retry if max_retry is None else max_retry
        for attempt in range(max_retry + 1):
            action, violations = self.check(action, card, turn=turn)
            if not violations:
                return action
            logger.info("角色 %s 越界（%s），第 %d 次处理", card.name,
                        [v.violation_type for v in violations], attempt + 1)
            if attempt < max_retry:
                action = self._regenerate(action, violations, card, turn)
            else:
                logger.info("角色 %s 重试耗尽，强制 silence", card.name)
                return {"action_type": "silence", "content": "……", "target": None}
        return action

    def _regenerate(self, action: dict, violations: list[BoundaryViolation],
                    card: CharacterCard, turn: int) -> dict:
        tracer = get_tracer()
        with tracer.trace("boundary.regenerate", tags=["boundary"], character=card.name, turn=turn) as span:
            bad = "\n".join(
                f"- 「{v.claim.subject} {v.claim.relation} {v.claim.object}」（你不该知道：{v.matched_unknown_fact}）"
                for v in violations
            )
            prompt = (
                f"你正在扮演角色「{card.name}」。你刚才的发言泄露了你不该知道的信息：\n{bad}\n\n"
                f"原发言：{action.get('content', '')}\n\n"
                f"你的性格：{card.personality}\n"
                f"说话风格：{card.speech_style or '自然'}\n\n"
                f"请重写这句发言：保持意图，但绝不能提及或暗示上述信息。"
                f"直接输出重写后的发言正文，不要任何解释。"
            )
            new_content = call_llm(prompt, tag="boundary",
                                   fallback="……（转移话题）嗯，没什么。")
            span.set_output(new_content[:200])
            new_action = dict(action)
            new_action["content"] = new_content.strip() or "……"
        return new_action

    def _log_violations(self, violations: list[BoundaryViolation]) -> None:
        try:
            p = PROJECT_ROOT / "logs" / "violations.jsonl"
            p.parent.mkdir(exist_ok=True)
            with p.open("a", encoding="utf-8") as f:
                for v in violations:
                    f.write(json.dumps(v.model_dump(), ensure_ascii=False) + "\n")
        except OSError:
            pass
