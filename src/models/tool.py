"""工具调用记录 — 聚焦点 C 专用。"""
from __future__ import annotations

from pydantic import BaseModel


class ToolCallRecord(BaseModel):
    id: str
    turn: int
    character: str  # 发起调用的角色（owner）
    tool_name: str
    arguments: dict
    result_summary: str  # 截断后的结果摘要（≤200 字符）
    latency_ms: float
    ok: bool
    error: str | None = None
