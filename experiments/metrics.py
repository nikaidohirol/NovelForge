"""评估指标计算（聚焦点 A + C + D）。

指标：涌现事件率 / 张力均值 / 张力方差 / 干预次数 / 角色一致性（LLM-as-Judge）/
工具调用率 / token 成本。
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

from config.settings import PROJECT_ROOT
from src.utils.llm import call_llm_json


def compute_metrics(batch_result: dict, tool_calls_before: int = 0) -> dict:
    tension = batch_result.get("tension_history", [])
    interventions = batch_result.get("interventions", [])
    logs = batch_result.get("logs", [])

    no_intervention_turns = len(logs) - len({i.get("turn") for i in interventions})
    emergence_turns = 0
    for log in logs:
        has_change = any(
            abs(float(e.get("importance", 0)) - 0.5) > 0.1
            for e in log.get("events", [])
            if e.get("action_type") not in ("intervention",)
        )
        if has_change:
            emergence_turns += 1
    emergence_rate = emergence_turns / max(1, no_intervention_turns)

    tool_calls_after = _count_tool_calls()
    tool_calls_in_run = max(0, tool_calls_after - tool_calls_before)
    total_agent_events = sum(
        1 for log in logs for e in log.get("events", [])
        if e.get("action_type") != "intervention"
    )

    return {
        "emergence_rate": round(emergence_rate, 3),
        "tension_mean": round(statistics.mean(tension), 3) if tension else 0.0,
        "tension_var": round(statistics.pvariance(tension), 3) if len(tension) > 1 else 0.0,
        "intervention_count": len(interventions),
        "total_turns": batch_result.get("total_turns", len(logs)),
        "tool_call_count": tool_calls_in_run,
        "tool_call_rate": round(tool_calls_in_run / max(1, total_agent_events), 3),
        "elapsed_s": batch_result.get("elapsed_s", 0.0),
    }


def judge_consistency(chapter: dict, cards: dict) -> float:
    """LLM-as-Judge：章节内容与角色卡性格/说话风格的一致性，1-5 分。"""
    personas = "\n".join(
        f"- {c.name}：{c.personality}｜风格：{c.speech_style or '自然'}"
        for c in cards.values()
    )
    prompt = (
        "请评估以下小说章节中角色言行与其人设的一致性，1-5 分（5 为完全一致）。\n"
        f"输出 JSON：{{\"score\": 数字, \"reason\": \"一句话理由\"}}\n\n"
        f"[角色人设]\n{personas}\n\n[章节内容（截断）]\n{chapter.get('content', '')[:3000]}"
    )
    result = call_llm_json(prompt, tag="judge")
    try:
        return float(result.get("score", 3)) if isinstance(result, dict) else 3.0
    except (TypeError, ValueError, AttributeError):
        return 3.0


def _count_tool_calls() -> int:
    p = PROJECT_ROOT / "logs" / "tool_calls.jsonl"
    if not p.exists():
        return 0
    return len([ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()])


def aggregate(runs: list[dict]) -> dict:
    """按策略聚合：mean ± std。"""
    by_strategy: dict[str, list[dict]] = {}
    for run in runs:
        by_strategy.setdefault(run["strategy"], []).append(run["metrics"])

    summary = {}
    for strategy, items in by_strategy.items():
        agg = {}
        for key in items[0]:
            values = [it[key] for it in items if isinstance(it.get(key), (int, float))]
            if values:
                agg[key] = {
                    "mean": round(statistics.mean(values), 4),
                    "std": round(statistics.pstdev(values), 4) if len(values) > 1 else 0.0,
                }
        summary[strategy] = agg
    return summary
