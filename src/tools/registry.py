"""构建默认只读工具注册表（聚焦点 C）。"""
from __future__ import annotations

from typing import TYPE_CHECKING

from src.tools.base import ToolRegistry
from src.tools.memory_search import SearchMemoryTool
from src.tools.relation_graph import QueryRelationsTool
from src.tools.world_info import ObserveWorldTool

if TYPE_CHECKING:
    import networkx as nx

    from src.memory.role_memory import RoleMemory
    from src.models.world import WorldState


def build_default_tools(
    memories: dict[str, "RoleMemory"],
    relation_graph: "nx.Graph",
    world_ref: dict,
) -> ToolRegistry:
    """world_ref 为 {"world": WorldState} 引用容器。"""
    return ToolRegistry([
        SearchMemoryTool(memories),
        QueryRelationsTool(relation_graph),
        ObserveWorldTool(world_ref),
    ])
