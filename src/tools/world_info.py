"""observe_world：世界状态只读观察。"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.tools.base import Tool

if TYPE_CHECKING:
    from src.models.world import WorldState


class ObserveWorldTool(Tool):
    name = "observe_world"
    description = "观察当前世界状态：地点、时间、在场角色、最近公开事件、当前张力。只读。"
    parameters = {"type": "object", "properties": {}, "required": []}

    def __init__(self, world_ref: dict):
        # world_ref: {"world": WorldState} 引用容器，避免工具持有陈旧副本
        self.world_ref = world_ref

    def run(self, owner: str) -> dict:
        world: "WorldState" = self.world_ref["world"]
        recent = world.recent_events[-5:]
        tension = world.tension_history[-1] if world.tension_history else 0.0
        return {
            "location": world.location,
            "time_of_day": world.time_of_day,
            "characters": list(world.characters.keys()),
            "recent_events": recent,
            "current_tension": round(tension, 2),
            "note": "recent_events 为公开信息，所有人都看得到",
        }
