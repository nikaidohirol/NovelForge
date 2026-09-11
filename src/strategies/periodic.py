"""策略 C：周期性注入 — 固定每 K 轮触发一次，四种干预类型轮转。"""
from __future__ import annotations

from src.models.world import WorldState
from src.strategies.base import INTERVENTION_TYPES, InterventionStrategy
from src.strategies.rate_based import RateBasedStrategy
from src.strategies.threshold import ThresholdStrategy


class PeriodicStrategy(InterventionStrategy):
    def __init__(self, interval: int = 8):
        self.interval = interval

    @property
    def name(self) -> str:
        return "periodic"

    def should_intervene(self, world: WorldState, history: list[float]) -> bool:
        return world.turn > 0 and world.turn % self.interval == 0

    def select_intervention_type(self, world: WorldState) -> str:
        idx = (world.turn // self.interval) % len(INTERVENTION_TYPES)
        return INTERVENTION_TYPES[idx]

    def _params(self) -> dict:
        return {"interval": self.interval}


def load_strategy(name: str | None = None) -> InterventionStrategy:
    from config.settings import get_settings

    s = get_settings()
    key = (name or s.intervention_strategy).lower()
    if key == "threshold":
        return ThresholdStrategy(threshold=s.tension_threshold)
    if key == "rate_based":
        return RateBasedStrategy(rate_threshold=s.rate_threshold)
    if key == "periodic":
        return PeriodicStrategy(interval=s.periodic_interval)
    raise ValueError(f"未知策略: {key}（可选 threshold / rate_based / periodic）")
