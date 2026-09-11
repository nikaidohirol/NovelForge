"""干预策略抽象基类（聚焦点 A）：可插拔设计。"""
from __future__ import annotations

from abc import ABC, abstractmethod

from src.models.world import WorldState

INTERVENTION_TYPES = ("external_event", "secret_reveal", "deadline", "new_character")


class InterventionStrategy(ABC):
    @abstractmethod
    def should_intervene(self, world: WorldState, history: list[float]) -> bool: ...

    @abstractmethod
    def select_intervention_type(self, world: WorldState) -> str: ...

    @property
    @abstractmethod
    def name(self) -> str: ...

    def describe(self) -> dict:
        return {"name": self.name, "params": self._params()}

    def _params(self) -> dict:
        return {}
