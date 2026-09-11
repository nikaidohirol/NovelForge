"""策略 B：变化率触发 — 关系值变化率滑动平均连续 N 轮低于阈值则干预。"""
from __future__ import annotations

from src.models.world import WorldState
from src.strategies.base import InterventionStrategy


class RateBasedStrategy(InterventionStrategy):
    def __init__(self, rate_threshold: float = 0.05, consecutive_turns: int = 3):
        self.rate_threshold = rate_threshold
        self.consecutive_turns = consecutive_turns

    @property
    def name(self) -> str:
        return "rate_based"

    def _turn_delta(self, world: WorldState, i: int, history: list[float]) -> float:
        """用张力曲线的逐轮差分近似互动变化率（无需 LLM，纯可计算）。"""
        if i == 0:
            return abs(history[0]) * 0.1
        return abs(history[i] - history[i - 1])

    def should_intervene(self, world: WorldState, history: list[float]) -> bool:
        if len(history) < self.consecutive_turns + 1:
            return False
        rates = [self._turn_delta(world, i, history)
                 for i in range(len(history) - self.consecutive_turns, len(history))]
        avg_rates = [r / max(1, 1) for r in rates]
        return all(r < self.rate_threshold for r in avg_rates)

    def select_intervention_type(self, world: WorldState) -> str:
        # 互动模式固化 → 优先新角色入场；否则揭秘
        if world.turn >= 6 and len(world.characters) <= 3:
            return "new_character"
        return "secret_reveal"

    def _params(self) -> dict:
        return {"rate_threshold": self.rate_threshold,
                "consecutive_turns": self.consecutive_turns}
