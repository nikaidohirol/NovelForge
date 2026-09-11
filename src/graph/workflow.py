"""LangGraph 状态图编排（批量/CLI 路径：checkpointer 断点恢复，无 HITL）。

交互模式（WebSocket 暂停/单步/人工确认）走 engine/simulation.py 的引擎自管循环，
两条路径复用同一套 Agent / 导演 / 工具 / 边界组件，避免双机制冲突（v2 评审修复 #1）。
"""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, TypedDict

from config.settings import get_settings
from src.engine.simulation import SimulationEngine
from src.models.character import CharacterCard
from src.models.narrative import Chapter, SceneLog
from src.observability.trace import get_tracer
from src.rewrite.coordinator import NarrativeCoordinator
from src.utils.logger import get_logger

logger = get_logger(__name__)


class NovelState(TypedDict):
    world: Any            # WorldState（pydantic，LangGraph JsonPlusSerializer 兼容）
    turn: int
    logs: list[SceneLog]
    current_scene: dict
    tension: float
    should_intervene: bool
    done: bool
    chapter: dict | None


def build_graph(engine: SimulationEngine, checkpointer=None):
    """以 SimulationEngine 为运行时构建状态图（runtime 注入，state 保持纯数据）。"""
    from langgraph.graph import END, StateGraph

    def schedule(state: NovelState, config) -> dict:
        scene = engine.director.schedule_next_scene(engine.world, engine.cards)
        return {"current_scene": scene}

    def character_act(state: NovelState, config) -> dict:
        scene = state["current_scene"]
        recent: list = []
        turn_logs: list[dict] = []
        for char_name in scene["participants"]:
            agent = engine.agents[char_name]
            event = asyncio.run(agent.act_async(engine.world, scene))
            event.importance = _score(event, char_name)
            engine.memories[char_name].add(_entry(event, char_name))
            engine.global_memory.add(event)
            engine._update_world(event)
            recent.append(event)
            turn_logs.append(event.model_dump())
        # 张力评估
        tension = engine.director.evaluate_tension(engine.world, recent)
        engine.world.tension_history.append(tension)
        logger.info("[turn %d] tension=%.2f", engine.world.turn, tension)
        should_intervene = engine.director.should_intervene(engine.world)
        return {
            "logs": state["logs"] + [SceneLog(
                location=scene["location"],
                participants=scene["participants"],
                events=turn_logs,
                tension_curve=[tension],
            )],
            "tension": tension,
            "should_intervene": should_intervene,
        }

    def director_intervene(state: NovelState, config) -> dict:
        intervention = engine.director.generate_intervention(engine.world)
        engine.world.intervention_log.append(intervention)
        engine.world.recent_events.append(f"【干预】{intervention['content']}")
        ie = _mk_intervention_event(intervention, engine.world.turn)
        engine.global_memory.add(ie)
        for name in engine.memories:
            engine.memories[name].add(_entry(ie, name))
        return {"should_intervene": False}

    def check_termination(state: NovelState, config) -> dict:
        engine.world.turn += 1
        done = engine.world.turn >= engine.max_turns or engine.is_converged()
        return {"turn": engine.world.turn, "done": done}

    def evaluate_tension(state: NovelState) -> dict:
        return {}  # 张力已在 character_act 内计算（纯函数路径，保留节点便于扩展）

    def rewrite_narrative(state: NovelState, config) -> dict:
        pov = next(iter(engine.cards), "")
        chapter: Chapter = NarrativeCoordinator().rewrite(
            state["logs"], pov, engine.cards)
        return {"chapter": chapter.model_dump(mode="json")}

    graph = StateGraph(NovelState)
    graph.add_node("schedule", schedule)
    graph.add_node("character_act", character_act)
    graph.add_node("evaluate_tension", evaluate_tension)
    graph.add_node("intervene", director_intervene)
    graph.add_node("check_termination", check_termination)
    graph.add_node("rewrite", rewrite_narrative)

    graph.set_entry_point("schedule")
    graph.add_edge("schedule", "character_act")
    graph.add_edge("character_act", "evaluate_tension")
    graph.add_conditional_edges(
        "evaluate_tension",
        lambda s: "intervene" if s["should_intervene"] else "check_termination",
        ["intervene", "check_termination"],
    )
    graph.add_edge("intervene", "check_termination")
    graph.add_conditional_edges(
        "check_termination",
        lambda s: "schedule" if not s["done"] else "rewrite",
        ["schedule", "rewrite"],
    )
    graph.add_edge("rewrite", END)
    return graph.compile(checkpointer=checkpointer)


def _score(event, character: str) -> float:
    from src.memory.importance import score_event

    return score_event(event, character)


def _entry(event, character: str):
    from src.memory.role_memory import make_entry

    return make_entry(character, f"[{event.actor} · {event.action_type}] {event.content}",
                      event.turn, event.importance)


def _mk_intervention_event(intervention: dict, turn: int):
    from src.models.event import Event

    return Event(turn=turn, actor="导演", action_type="intervention",
                 content=intervention["content"],
                 intervention_type=intervention["type"],
                 reason=intervention["reason"], importance=0.9)


def run_batch(
    characters: list[CharacterCard],
    initial_scene: dict,
    max_turns: int | None = None,
    strategy_name: str | None = None,
    use_sqlite_checkpointer: bool = True,
) -> dict:
    """批量运行入口（CLI / experiments）：返回 logs + chapter + 摘要。"""
    s = get_settings()
    session_id = f"batch_{uuid.uuid4().hex[:8]}"
    engine = SimulationEngine(
        characters, initial_scene, session_id=session_id,
        strategy_name=strategy_name, max_turns=max_turns,
        broadcast=None, confirm=None,
    )
    checkpointer = None
    if use_sqlite_checkpointer:
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver

            cm = SqliteSaver.from_conn_string(str(
                __import__("pathlib").Path(s.langgraph_checkpoint_dir) / "batch.sqlite"))
            checkpointer = cm.__enter__()
        except Exception as e:
            logger.warning("SqliteSaver 不可用，无 checkpointer 运行: %s", e)

    graph = build_graph(engine, checkpointer=checkpointer)
    start = time.time()
    final_state = graph.invoke(
        {"logs": [], "done": False, "chapter": None},
        config={"configurable": {"thread_id": session_id}},
    )
    tracer = get_tracer()
    tracer.flush()
    return {
        "session_id": session_id,
        "logs": [log.model_dump(mode="json") for log in final_state.get("logs", [])],
        "chapter": final_state.get("chapter"),
        "tension_history": engine.world.tension_history,
        "interventions": engine.world.intervention_log,
        "total_turns": engine.world.turn,
        "elapsed_s": round(time.time() - start, 1),
    }
