"""角色 Agent：perceive → decide(工具循环) → act → boundary_check。

聚焦点 C：决策内 Function Calling 循环。
- 感知工具若干次（预算 TOOL_MAX_CALLS_PER_TURN）
- 必须以 submit_action 工具调用收尾（干净的循环终止条件）
- 预算耗尽 / 解析失败 → 强制 silence 降级
聚焦点 B：最终发言经 BoundaryGuard.enforce 拦截重生成。
"""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Callable

from config.settings import get_settings
from src.agents.base import BaseAgent
from src.boundary.boundary_guard import BoundaryGuard
from src.memory.role_memory import RoleMemory
from src.models.character import CharacterCard
from src.models.event import Event
from src.models.tool import ToolCallRecord
from src.models.world import WorldState
from src.tools.base import ToolRegistry
from src.utils.llm import ToolCall, call_llm_with_tools
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from src.tools.relation_graph import QueryRelationsTool

logger = get_logger(__name__)

VALID_ACTIONS = {"speak", "move", "use", "observe", "silence"}

SUBMIT_ACTION_SCHEMA = {
    "type": "function",
    "function": {
        "name": "submit_action",
        "description": "提交你的最终行动。调用本工具即结束决策。",
        "parameters": {
            "type": "object",
            "properties": {
                "action_type": {
                    "type": "string",
                    "enum": sorted(VALID_ACTIONS),
                    "description": "行动类型",
                },
                "content": {"type": "string", "description": "发言/动作内容"},
                "target": {"type": "string", "description": "目标角色（可选）"},
            },
            "required": ["action_type", "content"],
        },
    },
}


class CharacterAgent(BaseAgent):
    def __init__(self, card: CharacterCard, memory: RoleMemory,
                 tools: ToolRegistry, boundary_guard: BoundaryGuard):
        super().__init__(card)
        self.memory = memory
        self.tools = tools
        self.boundary_guard = boundary_guard
        self.settings = get_settings()
        self.last_tool_calls: list[ToolCallRecord] = []
        self.boundary_violations: int = 0

    # ---------------------------------------------------------------- perceive
    def perceive(self, world: WorldState, scene: dict) -> str:
        others = [n for n in world.characters if n != self.name]
        related = self.memory.retrieve(
            self.name,
            query=f"{world.location} {world.recent_events[-1] if world.recent_events else scene.get('description', '')}",
            k=5,
        )
        memory_lines = "\n".join(f"- （第{e.turn}轮）{e.content}" for e in related) or "（暂无相关记忆）"
        return (
            f"地点：{world.location} | 时间：{world.time_of_day}\n"
            f"在场角色：{', '.join(others) or '无'}\n"
            f"最近发生：{'；'.join(world.recent_events[-3:]) or '（尚无）'}\n"
            f"你的相关记忆：\n{memory_lines}\n"
            f"你的状态：情绪 {self._emotion(world)} | "
            f"关系值 {{{', '.join(f'{k}:{v:.1f}' for k, v in (world.characters.get(self.name).affinity.items() if world.characters.get(self.name) else [])) or '无'}}}"
        )

    def _emotion(self, world: WorldState) -> str:
        state = world.characters.get(self.name)
        return state.emotion if state else "neutral"

    # ---------------------------------------------------------------- prompt
    def _build_messages(self, perception: str, scene: dict) -> list[dict]:
        c = self.card
        system = (
            f"你正在扮演角色 {c.name}。\n"
            f"性格：{c.personality}\n"
            f"说话风格：{c.speech_style or '自然对话'}\n"
            f"当前目标：{'；'.join(c.goals) or '无'}\n"
            f"你已知的信息：{'；'.join(c.knowledge_boundary) or '无'}\n"
            f"你**不知道**的信息：{'；'.join(c.unknown_facts) or '无'}（绝对不能提及或暗示）\n"
            f"与其他角色的关系：{json.dumps(c.relations, ensure_ascii=False)}\n\n"
            f"[可用工具]\n"
            f"你可以调用以下只读工具来回忆与观察（不要编造工具结果）：\n"
            f"- search_memory(query)：检索你自己（{c.name}）的记忆\n"
            f"- query_relations(character)：查询角色关系图\n"
            f"- observe_world()：观察当前地点、在场角色与最近公开事件\n\n"
            f"[对话示例]\n{c.data.mes_example or '（无）'}\n\n"
            f"[角色卡描述]\n{c.data.description}"
        )
        user = (
            f"[当前场景]\n{scene.get('description', '')}\n\n"
            f"[你的感知]\n{perception}\n\n"
            f"请以 {c.name} 的身份决策下一步行动：可先调用感知工具，再调用 submit_action 提交最终行动。\n"
            f"submit_action 参数：action_type ∈ speak/move/use/observe/silence，content 为发言或动作内容，target 为目标角色（可选）。"
        )
        return [{"role": "system", "content": system},
                {"role": "user", "content": user}]

    # ---------------------------------------------------------------- decide（工具循环）
    def decide(self, perception: str, world: WorldState, scene: dict,
               on_tool_call: Callable[[ToolCallRecord], None] | None = None) -> dict:
        messages = self._build_messages(perception, scene)
        budget = self.settings.tool_max_calls_per_turn
        tool_schemas = self.tools.openai_schemas() + [SUBMIT_ACTION_SCHEMA]

        with self.trace(f"agent.{self.name}.decide", tags=["agent", "decide"],
                        turn=world.turn) as span:
            for _ in range(budget):
                resp = call_llm_with_tools(messages, tool_schemas, tag="decide")
                if resp.tool_calls:
                    messages.append(resp.assistant_message or {
                        "role": "assistant", "content": resp.content})
                    for tc in resp.tool_calls:
                        if tc.name == "submit_action":
                            action = self._validate_action(tc.arguments)
                            span.set_output(json.dumps(action, ensure_ascii=False)[:200])
                            span.meta["tool_calls_used"] = len(self.last_tool_calls)
                            return action
                        record = self.tools.execute(tc, owner=self.name, turn=world.turn)
                        self.last_tool_calls.append(record)
                        if on_tool_call:
                            on_tool_call(record)
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": record.result_summary or (record.error or "（工具执行失败）"),
                        })
                else:
                    # 未调用工具：尝试从 content 解析 JSON 行动
                    action = self._parse_action_text(resp.content)
                    if action is not None:
                        span.set_output(json.dumps(action, ensure_ascii=False)[:200])
                        return action
                    messages.append({"role": "assistant", "content": resp.content})
                    messages.append({"role": "user",
                                     "content": "请调用 submit_action 工具提交你的最终行动。"})

            # 预算耗尽：强制降级为沉默，避免失控
            logger.info("角色 %s 决策预算耗尽，降级 silence", self.name)
            span.set_output("budget exhausted -> silence")
            span.meta["degraded"] = True
            return {"action_type": "silence", "content": "……", "target": None}

    def _validate_action(self, args: dict) -> dict:
        action_type = str(args.get("action_type", "silence"))
        if action_type not in VALID_ACTIONS:
            action_type = "silence"
        return {
            "action_type": action_type,
            "content": str(args.get("content", "……")),
            "target": args.get("target") or None,
        }

    def _parse_action_text(self, content: str) -> dict | None:
        from src.utils.llm import _extract_json

        data = _extract_json(content or "")
        if isinstance(data, dict) and data.get("action_type") in VALID_ACTIONS:
            return self._validate_action(data)
        return None

    # ---------------------------------------------------------------- act
    def act(self, world: WorldState, scene: dict,
            on_tool_call: Callable[[ToolCallRecord], None] | None = None) -> Event:
        self.last_tool_calls = []
        perception = self.perceive(world, scene)
        action = self.decide(perception, world, scene, on_tool_call)

        # ★ 聚焦点 B：知识边界检查（仅约束发言）
        if action["action_type"] == "speak":
            before = action["content"]
            action = self.boundary_guard.enforce(action, self.card, turn=world.turn)
            if action["content"] != before:
                self.boundary_violations += 1

        return Event(
            turn=world.turn,
            actor=self.name,
            action_type=action["action_type"],
            content=action["content"],
            target=action.get("target"),
        )

    async def act_async(self, world: WorldState, scene: dict,
                        on_tool_call=None) -> Event:
        return await asyncio.to_thread(self.act, world, scene, on_tool_call)
