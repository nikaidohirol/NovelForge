"""叙事重写：互动日志 → 章节体小说（润色 + 视角化，非重新创作）。"""
from __future__ import annotations

from config.settings import get_settings
from src.models.character import CharacterCard
from src.models.narrative import Chapter, SceneLog
from src.observability.trace import get_tracer
from src.utils.llm import call_llm
from src.utils.logger import get_logger

logger = get_logger(__name__)

MIN_IMPORTANCE = 0.3


class NarrativeCoordinator:
    def rewrite(self, logs: list[SceneLog], pov_character: str,
                cards: dict[str, CharacterCard] | None = None) -> Chapter:
        cards = cards or {}
        card = cards.get(pov_character)
        kept = [
            e for log in logs for e in log.events
            if float(e.get("importance", 0.5)) >= MIN_IMPORTANCE
        ]
        settings = get_settings()

        events_text = "\n".join(
            f"[第{e.get('turn', 0)}轮] {e.get('actor', '?')}（{e.get('action_type', 'speak')}）"
            f"→ {e.get('target') or '全场'}：{e.get('content', '')}"
            for e in kept
        ) or "（无足够重要的事件）"

        system = (
            "你是一个轻小说作家。请将以下多角色互动日志重写为一章小说。\n"
            f"视角角色：{pov_character}"
            + (f" | 性格：{card.personality} | 说话风格：{card.speech_style or '自然'}" if card else "")
        )
        prompt = (
            f"[要求]\n"
            f"- 以 {pov_character} 的第三人称有限视角叙述\n"
            f"- 保留所有 importance >= {MIN_IMPORTANCE} 的事件，不得虚构新事件\n"
            f"- 为 {pov_character} 补全符合其性格的内心活动\n"
            f"- 对话需符合各角色的说话风格\n"
            f"- 输出格式：第一行为章节标题（以「第」开头），空一行后为正文\n\n"
            f"[互动日志]\n{events_text}"
        )
        with get_tracer().trace("rewrite.chapter", tags=["rewrite"]) as span:
            content = call_llm(prompt, system=system, tag="rewrite",
                               fallback=self._fallback_chapter(pov_character, kept))
            span.set_output(content[:200])

        title, body = self._split_title(content, pov_character)
        return Chapter(
            title=title,
            content=body,
            word_count=len(body),
            scenes=logs,
        )

    @staticmethod
    def _split_title(content: str, pov: str) -> tuple[str, str]:
        content = content.strip()
        lines = content.split("\n", 1)
        if len(lines) == 2 and ("章" in lines[0][:20] or "第" in lines[0][:4]):
            return lines[0].strip(), lines[1].strip()
        return f"第？章 · {pov}的视角", content

    @staticmethod
    def _fallback_chapter(pov: str, events: list[dict]) -> str:
        body = "\n\n".join(
            f"（第{e.get('turn', 0)}轮）{e.get('actor', '?')}：{e.get('content', '')}"
            for e in events
        )
        return f"第？章 · {pov}的视角\n\n（LLM 生成失败，以下为原始事件流水）\n\n{body}"
