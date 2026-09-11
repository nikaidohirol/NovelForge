"""叙事输出模型。"""
from __future__ import annotations

from pydantic import BaseModel


class SceneLog(BaseModel):
    location: str
    participants: list[str]
    events: list[dict]
    tension_curve: list[float]
    interventions: list[dict] = []


class Chapter(BaseModel):
    title: str
    content: str
    word_count: int
    scenes: list[SceneLog]
