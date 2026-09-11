"""互动引擎 + LangGraph 批量路径端到端冒烟（mock 后端，小规模）。"""
from __future__ import annotations

from src.engine.simulation import SimulationEngine, build_relation_graph
from src.models.narrative import SceneLog


async def test_engine_step_once(two_cards, mock_backend):
    engine = SimulationEngine(two_cards, {"location": "咖啡店", "time_of_day": "傍晚"},
                              session_id="test", max_turns=5)
    await engine.step_once()
    assert len(engine.scene_logs) == 1
    assert len(engine.world.tension_history) == 1
    assert engine.world.turn == 1
    log: SceneLog = engine.scene_logs[0]
    assert len(log.events) == 2  # 两个角色各一条
    assert engine.memories["艾莉丝"].count() >= 1
    assert engine.global_memory.retrieve("咖啡店") is not None


async def test_engine_run_full(two_cards, mock_backend):
    engine = SimulationEngine(two_cards, {"location": "咖啡店"}, session_id="test2",
                              max_turns=3)
    broadcasts = []

    async def broadcast(msg):
        broadcasts.append(msg)

    engine.broadcast_fn = broadcast
    logs = await engine.run()
    assert engine.status == "done"
    assert len(logs) == 3
    types = [b["type"] for b in broadcasts]
    assert "turn_start" in types
    assert "character_action" in types
    assert "tension_update" in types
    assert "simulation_end" in types


def test_build_relation_graph(two_cards):
    g = build_relation_graph(two_cards)
    assert set(g.nodes) == {"艾莉丝", "鲍勃"}
    assert g.has_edge("艾莉丝", "鲍勃")


def test_batch_workflow(two_cards, mock_backend):
    """LangGraph 批量路径：2 回合 + 章节重写。"""
    from src.graph.workflow import run_batch

    result = run_batch(two_cards, {"location": "咖啡店", "time_of_day": "傍晚"},
                       max_turns=2, strategy_name="periodic")
    assert result["total_turns"] == 2
    assert len(result["logs"]) == 2
    assert result["chapter"] is not None
    assert result["chapter"]["content"]
