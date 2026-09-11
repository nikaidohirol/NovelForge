"""声明抽取（聚焦点 B）：将发言解析为 Claim(subject, relation, object) 三元组列表。"""
from __future__ import annotations

from src.models.claim import Claim
from src.utils.llm import call_llm_json


class ClaimExtractor:
    def extract(self, utterance: str) -> list[Claim]:
        if not utterance or not utterance.strip():
            return []
        prompt = (
            "将以下发言解析为结构化声明列表。每条声明格式为：\n"
            '{"subject": "...", "relation": "...", "object": "..."}\n\n'
            "subject/relation/object 必须从发言中提取，不要推理补全。\n"
            "若发言不包含可提取的事实声明（如疑问、感叹、动作），返回空数组 []。\n"
            f"\n发言：{utterance}"
        )
        result = call_llm_json(prompt, schema={"type": "array"}, tag="boundary")
        claims: list[Claim] = []
        if isinstance(result, list):
            items = result
        elif isinstance(result, dict) and isinstance(result.get("claims"), list):
            items = result["claims"]
        elif isinstance(result, dict) and "subject" in result:
            items = [result]  # LLM 偶尔返回单对象而非数组
        else:
            return []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                claims.append(Claim(
                    subject=str(item.get("subject", "")),
                    relation=str(item.get("relation", "")),
                    object=str(item.get("object", "")),
                    raw_text=utterance,
                    confidence=float(item.get("confidence", 1.0)),
                ))
            except (TypeError, ValueError):
                continue
        return claims
