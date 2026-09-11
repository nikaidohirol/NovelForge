"""世界状态。注意：仅存放可 JSON 序列化的纯数据（LangGraph checkpointer 兼容）。"""
from __future__ import annotations

from pydantic import BaseModel, Field

from .character import CharacterState


class WorldState(BaseModel):
    turn: int = 0
    location: str = "unknown"
    time_of_day: str = "morning"
    characters: dict[str, CharacterState] = Field(default_factory=dict)
    active_flags: dict[str, bool] = Field(default_factory=dict)
    tension_history: list[float] = Field(default_factory=list)
    recent_events: list[str] = Field(default_factory=list)
    intervention_log: list[dict] = Field(default_factory=list)
