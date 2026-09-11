"""importance 评分器：LLM 打分（便宜模型档），失败 fallback 0.5。"""
from __future__ import annotations

from src.models.event import Event
from src.utils.llm import call_llm_json


def score_event(event: Event, character: str) -> float:
    prompt = (
        f"该事件对角色{character}的目标推进/关系变化/知识获取的影响程度，"
        f"0-1分，只输出数字。\n"
        f"事件：[{event.actor} · {event.action_type}] {event.content}"
    )
    result = call_llm_json(prompt, tag="importance")
    if isinstance(result, dict):
        value = result.get("score", result.get("importance", 0.5))
    elif isinstance(result, (int, float)):
        value = result
    else:
        value = 0.5
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = 0.5
    return min(1.0, max(0.0, value))
