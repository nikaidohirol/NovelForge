"""声明模型 — 聚焦点 B（知识边界）专用。"""
from __future__ import annotations

from pydantic import BaseModel


class Claim(BaseModel):
    subject: str
    relation: str
    object: str
    raw_text: str = ""
    confidence: float = 1.0


class BoundaryViolation(BaseModel):
    turn: int
    character: str
    claim: Claim
    violation_type: str  # "direct_match" | "semantic_match"
    matched_unknown_fact: str
