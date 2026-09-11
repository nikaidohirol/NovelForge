"""Agent 基类：名字 + 角色卡 + 统一 trace 工具。"""
from __future__ import annotations

from src.models.character import CharacterCard
from src.observability.trace import get_tracer


class BaseAgent:
    def __init__(self, card: CharacterCard):
        self.card = card

    @property
    def name(self) -> str:
        return self.card.name

    def trace(self, name: str, tags: list[str] | None = None, **meta):
        return get_tracer().trace(name, tags=tags, character=self.name, **meta)
