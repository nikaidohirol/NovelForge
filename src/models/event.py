"""事件 + 记忆条目。"""
from __future__ import annotations

from pydantic import BaseModel


class Event(BaseModel):
    turn: int
    actor: str
    action_type: str  # speak / move / use / observe / silence / intervention
    content: str
    target: str | None = None
    importance: float = 0.5
    # 干预事件附加信息
    intervention_type: str | None = None
    reason: str | None = None


class MemoryEntry(BaseModel):
    id: str
    character: str
    content: str
    turn: int
    importance: float
    embedding: list[float] | None = None
