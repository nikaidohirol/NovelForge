"""角色卡 + 运行时状态。兼容 Character Card V2 规范。"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CharacterCardData(BaseModel):
    name: str
    description: str
    personality: str
    scenario: Optional[str] = None
    first_mes: Optional[str] = None
    mes_example: Optional[str] = None
    system_prompt: Optional[str] = None
    post_history_instructions: Optional[str] = None


class CharacterCard(BaseModel):
    spec: str = "chara_card_v2"
    spec_version: str = "2.0"
    data: CharacterCardData

    # 叙事引擎扩展字段
    goals: list[str] = Field(default_factory=list)
    knowledge_boundary: list[str] = Field(default_factory=list)
    unknown_facts: list[str] = Field(default_factory=list)
    speech_style: Optional[str] = None
    relations: dict[str, str] = Field(default_factory=dict)
    avatar_color: str = "#B8A9E8"

    @property
    def name(self) -> str:
        return self.data.name

    @property
    def personality(self) -> str:
        return self.data.personality


class CharacterState(BaseModel):
    name: str
    current_location: str = "unknown"
    emotion: str = "neutral"
    affinity: dict[str, float] = Field(default_factory=dict)
    active_goals: list[str] = Field(default_factory=list)
    memory_ids: list[str] = Field(default_factory=list)
