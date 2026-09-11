"""策略 A：阈值触发 — 连续 N 轮张力 < threshold 则干预。"""
from __future__ import annotations

from src.models.world import WorldState
from src.strategies.base import InterventionStrategy


class ThresholdStrategy(InterventionStrategy):
    def __init__(self, threshold: float = 3.0, consecutive_turns: int = 3):
        self.threshold = threshold
        self.consecutive_turns = consecutive_turns

    @property
    def name(self) -> str:
        return "threshold"

    def should_intervene(self, world: WorldState, history: list[float]) -> bool:
        if len(history) < self.consecutive_turns:
            return False
        return all(t < self.threshold for t in history[-self.consecutive_turns:])

    def select_intervention_type(self, world: WorldState) -> str:
        # 目标对立程度高 → 加时间压力；信息事件少 → 揭秘
        goal_count = sum(len(s.active_goals) for s in world.characters.values())
        events = len(world.recent_events)
        if goal_count >= 4:
            return "deadline"
        if events < 4:
            return "secret_reveal"
        return "external_event"

    def _params(self) -> dict:
        return {"threshold": self.threshold, "consecutive_turns": self.consecutive_turns}
