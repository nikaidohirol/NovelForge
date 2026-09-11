"""search_memory：检索调用者自己的记忆（强制 owner 隔离）。"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.tools.base import Tool, truncate

if TYPE_CHECKING:
    from src.memory.role_memory import RoleMemory


class SearchMemoryTool(Tool):
    name = "search_memory"
    description = "检索你自己（调用者）过往的记忆片段。只能查自己的记忆，无法查他人。"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "检索关键词或问题"},
            "k": {"type": "integer", "description": "返回条数（默认 5）"},
        },
        "required": ["query"],
    }

    def __init__(self, memories: dict[str, "RoleMemory"]):
        self.memories = memories

    def run(self, owner: str, query: str, k: int = 5) -> dict:
        memory = self.memories.get(owner)
        if memory is None:
            return {"memories": [], "note": "没有可用记忆"}
        k = max(1, min(int(k), 10))
        entries = memory.retrieve(character=owner, query=query, k=k)
        return {
            "memories": [
                {"turn": e.turn, "content": e.content, "importance": round(e.importance, 2)}
                for e in entries
            ],
            "note": "以上是你自己的记忆，他人无从知晓" if entries else "未检索到相关记忆",
        }


__all__ = ["SearchMemoryTool", "truncate"]
