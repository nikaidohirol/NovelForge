"""query_relations：NetworkX 关系图只读查询。"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.tools.base import Tool

if TYPE_CHECKING:
    import networkx as nx


class QueryRelationsTool(Tool):
    name = "query_relations"
    description = "查询某角色的全部邻接关系与关系值。只读。"
    parameters = {
        "type": "object",
        "properties": {
            "character": {"type": "string", "description": "要查询的角色名"}
        },
        "required": ["character"],
    }

    def __init__(self, graph: "nx.Graph"):
        self.graph = graph

    def run(self, owner: str, character: str) -> dict:
        if character not in self.graph:
            return {"relations": [], "note": f"{character} 不在关系图中"}
        relations = []
        for neighbor, attrs in self.graph[character].items():
            relations.append({
                "other": neighbor,
                "affinity": attrs.get("affinity", 0.0),
                "description": attrs.get("description", ""),
            })
        return {"character": character, "relations": relations}
