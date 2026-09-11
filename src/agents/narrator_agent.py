"""叙事协调器：把重写 coordinator 包一层（保留接口位置）。"""
from __future__ import annotations

from src.models.character import CharacterCard
from src.models.narrative import SceneLog
from src.rewrite.coordinator import NarrativeCoordinator


class NarratorAgent:
    def __init__(self, card: CharacterCard | None = None):
        self.coordinator = NarrativeCoordinator()
        self.card = card

    def rewrite(self, logs: list[SceneLog], pov_character: str,
                cards: dict[str, CharacterCard] | None = None):
        return self.coordinator.rewrite(logs, pov_character, cards or {})
