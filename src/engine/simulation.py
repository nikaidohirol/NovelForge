"""互动循环引擎（交互模式，供 API/WebSocket 使用）。

设计决策（v2 评审修复 #1）：
- HITL 人工确认由引擎自管确认门（confirm_callback），不使用 LangGraph interrupt，
  避免与 WebSocket 循环产生双机制冲突。
- 批量/断点恢复场景走 graph/workflow.py（LangGraph + checkpointer）。
"""
from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

import networkx as nx

from config.settings import get_settings
from src.agents.character_agent import CharacterAgent
from src.agents.director_agent import DirectorAgent
from src.boundary.boundary_guard import BoundaryGuard
from src.memory.global_memory import GlobalMemory
from src.memory.importance import score_event
from src.memory.role_memory import RoleMemory
from src.models.character import CharacterCard
from src.models.event import Event
from src.models.narrative import SceneLog
from src.models.world import WorldState
from src.observability.trace import get_tracer
from src.strategies.periodic import load_strategy
from src.tools.registry import build_default_tools
from src.utils.llm import call_llm_json
from src.utils.logger import get_logger

logger = get_logger(__name__)

BroadcastFn = Callable[[dict], Awaitable[None]]
ConfirmFn = Callable[[dict], Awaitable[bool]]


def build_relation_graph(cards: list[CharacterCard]) -> nx.Graph:
    g = nx.Graph()
    for card in cards:
        g.add_node(card.name)
    for card in cards:
        for other, desc in card.relations.items():
            if other in {c.name for c in cards}:
                g.add_edge(card.name, other, affinity=0.0, description=desc)
    return g


class SimulationEngine:
    def __init__(
        self,
        characters: list[CharacterCard],
        initial_scene: dict,
        session_id: str = "cli",
        strategy_name: str | None = None,
        max_turns: int | None = None,
        broadcast: BroadcastFn | None = None,
        confirm: ConfirmFn | None = None,
    ):
        self.settings = get_settings()
        self.session_id = session_id
        self.cards = {c.name: c for c in characters}
        self.max_turns = max_turns or self.settings.max_turns
        self.broadcast_fn = broadcast
        self.confirm_fn = confirm if self.settings.human_confirm_intervention else None

        self.world = WorldState(
            location=initial_scene.get("location", "unknown"),
            time_of_day=initial_scene.get("time_of_day", "morning"),
            characters={
                c.name: _init_character_state(c, initial_scene) for c in characters
            },
        )
        self.world_ref = {"world": self.world}  # 工具只读引用容器

        self.memories = {c.name: RoleMemory(c.name) for c in characters}
        self.global_memory = GlobalMemory()
        self.graph = build_relation_graph(characters)
        registry = build_default_tools(self.memories, self.graph, self.world_ref)
        guard = BoundaryGuard()
        self.agents = {
            c.name: CharacterAgent(c, self.memories[c.name], registry, guard)
            for c in characters
        }
        self.director = DirectorAgent(load_strategy(strategy_name))
        self.strategy_name = self.director.strategy.name

        # 运行控制
        self.paused = False
        self.speed = 1.0
        self._stop = False
        self._step_requested = asyncio.Event()
        self.status = "idle"  # idle / running / paused / done / stopped
        self.scene_logs: list[SceneLog] = []
        self._stall_turns = 0
        self._last_affinity_snapshot: dict[str, float] = {}

    # ---------------------------------------------------------------- 广播
    async def broadcast(self, message: dict) -> None:
        message.setdefault("session_id", self.session_id)
        if self.broadcast_fn:
            try:
                await self.broadcast_fn(message)
            except Exception as e:
                logger.warning("广播失败（忽略）: %s", e)

    def _on_tool_call_factory(self, loop: asyncio.AbstractEventLoop):
        def _cb(record) -> None:
            asyncio.run_coroutine_threadsafe(
                self.broadcast({
                    "type": "tool_call",
                    "turn": record.turn,
                    "character": record.character,
                    "tool": record.tool_name,
                    "args": record.arguments,
                    "result_summary": record.result_summary,
                    "latency_ms": record.latency_ms,
                    "ok": record.ok,
                }),
                loop,
            )
        return _cb

    # ---------------------------------------------------------------- 主循环
    async def run(self) -> list[SceneLog]:
        loop = asyncio.get_running_loop()
        on_tool_call = self._on_tool_call_factory(loop)
        self.status = "running"
        tracer = get_tracer()

        with tracer.trace(f"simulation.{self.session_id}", tags=["simulation"]):
            while not self._stop and self.world.turn < self.max_turns:
                await self._wait_if_paused()
                if self._stop:
                    break
                await self.step_once(on_tool_call)
                await asyncio.sleep(max(0.0, 1.0 / max(self.speed, 0.1)))

        self.status = "stopped" if self._stop else "done"
        await self.broadcast({
            "type": "simulation_end",
            "total_turns": self.world.turn,
            "reason": "stopped" if self._stop else "converged",
        })
        tracer.flush()
        return self.scene_logs

    async def _wait_if_paused(self) -> None:
        if not self.paused:
            return
        self.status = "paused"
        while self.paused and not self._step_requested.is_set() and not self._stop:
            await asyncio.sleep(0.1)
        self._step_requested.clear()
        if not self.paused:
            self.status = "running"

    # ---------------------------------------------------------------- 单回合
    async def step_once(self, on_tool_call=None) -> None:
        loop = asyncio.get_running_loop()
        if on_tool_call is None:
            on_tool_call = self._on_tool_call_factory(loop)
        tracer = get_tracer()

        with tracer.trace(f"turn.{self.world.turn}", tags=["turn"], turn=self.world.turn):
            await self.broadcast({"type": "turn_start", "turn": self.world.turn,
                                  "scene": {"location": self.world.location}})
            scene = self.director.schedule_next_scene(self.world, self.cards)
            recent_events: list[Event] = []
            turn_logs: list[dict] = []

            for char_name in scene["participants"]:
                agent = self.agents[char_name]
                event = await agent.act_async(self.world, scene, on_tool_call)
                # importance 打分（LLM，便宜模型档）
                event.importance = score_event(event, char_name)
                # 记忆写入
                self.memories[char_name].add(
                    _to_memory_entry(event, char_name)
                )
                self.global_memory.add(event)
                self._update_world(event)
                recent_events.append(event)
                turn_logs.append(event.model_dump())
                await self.broadcast({
                    "type": "character_action",
                    "turn": self.world.turn,
                    "actor": event.actor,
                    "action_type": event.action_type,
                    "content": event.content,
                    "target": event.target,
                    "importance": round(event.importance, 2),
                    "avatar_color": self.cards[char_name].avatar_color,
                })

            # 张力评估（纯计算）
            tension = self.director.evaluate_tension(self.world, recent_events)
            self.world.tension_history.append(tension)
            await self.broadcast({
                "type": "tension_update",
                "turn": self.world.turn,
                "tension": tension,
                "history": [round(t, 2) for t in self.world.tension_history],
            })

            # 导演干预（含 HITL 确认门）
            interventions = []
            if self.director.should_intervene(self.world):
                preview = {"type": self.director.strategy.select_intervention_type(self.world),
                           "strategy": self.strategy_name, "turn": self.world.turn}
                approved = True
                if self.confirm_fn:
                    approved = await self.confirm_fn(preview)
                    await self.broadcast({
                        "type": "intervention_decision",
                        "turn": self.world.turn,
                        "approved": approved,
                    })
                if approved:
                    intervention = self.director.generate_intervention(self.world)
                    self.world.intervention_log.append(intervention)
                    interventions.append(intervention)
                    await self.broadcast({
                        "turn": self.world.turn,
                        **intervention,
                        "type": "director_intervention",  # 字面量置于展开后，避免被干预类型覆盖
                    })
                    ie = Event(turn=self.world.turn, actor="导演",
                               action_type="intervention",
                               content=intervention["content"],
                               intervention_type=intervention["type"],
                               reason=intervention["reason"], importance=0.9)
                    self.global_memory.add(ie)
                    turn_logs.append(ie.model_dump())
                    self.world.recent_events.append(f"【干预】{intervention['content']}")
                    for name, state in self.world.characters.items():
                        state.active_flags[f"intervened_{self.world.turn}"] = True
                        self.memories[name].add(_to_memory_entry(ie, name))

            self.scene_logs.append(SceneLog(
                location=scene["location"],
                participants=scene["participants"],
                events=turn_logs,
                tension_curve=[tension],
                interventions=interventions,
            ))
            self.world.turn += 1
            await self.broadcast({"type": "state_update",
                                  "world": self.world.model_dump(mode="json")})

    # ---------------------------------------------------------------- 状态更新
    def _update_world(self, event: Event) -> None:
        state = self.world.characters.get(event.actor)
        if state is None:
            return
        if event.action_type == "move":
            state.current_location = event.content[:30]
            return
        if event.action_type in ("speak", "observe", "use"):
            self.world.recent_events.append(f"{event.actor}：{event.content}")
            self.world.recent_events = self.world.recent_events[-30:]
        if event.action_type == "speak" and event.target and event.target in self.world.characters:
            delta = self._affinity_delta(event)
            target_state = self.world.characters[event.target]
            old = target_state.affinity.get(event.actor, 0.0)
            target_state.affinity[event.actor] = round(max(-3.0, min(3.0, old + delta)), 2)
            if self.graph.has_edge(event.target, event.actor):
                self.graph.edges[event.target, event.actor]["affinity"] = \
                    target_state.affinity[event.actor]

    def _affinity_delta(self, event: Event) -> float:
        """关系值变化（LLM 微调用，便宜模型档，fallback 0）。"""
        result = call_llm_json(
            f"角色「{event.actor}」对「{event.target}」说了：『{event.content}』\n"
            f"这一发言会使 {event.target} 对 {event.actor} 的关系值变化多少？"
            f"输出 JSON：{{\"delta\": -0.3 到 0.3 之间的小数}}",
            tag="world",
        )
        try:
            if isinstance(result, dict):
                return max(-0.3, min(0.3, float(result.get("delta", 0.0))))
        except (TypeError, ValueError):
            pass
        return 0.0

    # ---------------------------------------------------------------- 终止
    def is_converged(self) -> bool:
        # 条件 1：所有角色目标全部打上完成 flag
        all_done = all(
            all(self.world.active_flags.get(f"goal_done_{s.name}_{i}", False)
                for i in range(len(s.active_goals)))
            for s in self.world.characters.values()
        ) if self.world.characters else False
        if all_done:
            return True
        # 条件 2：连续 5 轮无关系值变化且无新事件
        snapshot = {n: s.affinity.get(other, 0.0)
                    for n, s in self.world.characters.items()
                    for other in s.affinity}
        if snapshot == self._last_affinity_snapshot and not self.world.recent_events:
            self._stall_turns += 1
        else:
            self._stall_turns = 0
        self._last_affinity_snapshot = snapshot
        return self._stall_turns >= 5

    # ---------------------------------------------------------------- 控制
    def pause(self) -> None:
        self.paused = True

    def resume(self) -> None:
        self.paused = False

    def request_step(self) -> None:
        self.paused = True
        self._step_requested.set()

    def stop(self) -> None:
        self._stop = True
        self.paused = False

    @property
    def status_info(self) -> dict:
        return {
            "session_id": self.session_id,
            "status": self.status,
            "turn": self.world.turn,
            "max_turns": self.max_turns,
            "strategy": self.strategy_name,
            "tension": self.world.tension_history[-1] if self.world.tension_history else None,
            "interventions": len(self.world.intervention_log),
        }


def _init_character_state(card: CharacterCard, scene: dict) -> "object":
    from src.models.character import CharacterState

    return CharacterState(
        name=card.name,
        current_location=scene.get("location", "unknown"),
        active_goals=list(card.goals),
        affinity={k: 0.0 for k in card.relations if k},
    )


def _to_memory_entry(event: Event, character: str):
    from src.memory.role_memory import make_entry

    return make_entry(
        character=character,
        content=f"[{event.actor} · {event.action_type}] {event.content}",
        turn=event.turn,
        importance=event.importance,
    )
