"""角色 Agent 测试（聚焦点 C 工具循环 + 决策降级）。"""
from __future__ import annotations

from src.agents.character_agent import CharacterAgent
from src.boundary.boundary_guard import BoundaryGuard
from src.memory.role_memory import RoleMemory
from src.models.character import CharacterCard, CharacterState
from src.models.world import WorldState
from src.tools.registry import build_default_tools
from src.utils.llm import LLMResponse, ToolCall, get_backend


def _make_agent(name: str = "艾莉丝") -> CharacterAgent:
    card = CharacterCard.model_validate({
        "spec": "chara_card_v2", "spec_version": "2.0",
        "data": {"name": name, "description": "d", "personality": "谨慎",
                 "mes_example": "「……」"},
        "goals": ["查明真相"], "unknown_facts": ["首领是谁"],
        "relations": {"鲍勃": "警惕"},
    })
    memory = RoleMemory(name)
    memories = {name: memory}
    world_ref = {"world": None}
    registry = build_default_tools(memories, _FakeGraph(), world_ref)
    return CharacterAgent(card, memory, registry, BoundaryGuard())


class _FakeGraph:
    def __contains__(self, name):
        return False

    def __getitem__(self, name):
        return {}


def _world() -> WorldState:
    return WorldState(turn=1, location="咖啡店",
                      characters={"艾莉丝": CharacterState(name="艾莉丝")})


def test_decide_via_submit_action(mock_backend):
    agent = _make_agent()
    action = agent.decide("场景", _world(), {"description": "咖啡店"})
    assert action["action_type"] == "speak"
    assert action["content"]


def test_tool_loop_then_submit(mock_backend):
    """先调用感知工具，再 submit_action 收尾 → last_tool_calls 有记录。"""
    backend = get_backend()
    backend.set_script([
        LLMResponse(tool_calls=[ToolCall(id="t1", name="query_relations",
                                         arguments={"character": "艾莉丝"})],
                     assistant_message={"role": "assistant", "content": ""}),
        LLMResponse(tool_calls=[ToolCall(id="t2", name="submit_action",
                                         arguments={"action_type": "observe",
                                                    "content": "环视店内"})]),
    ])
    agent = _make_agent()
    action = agent.decide("场景", _world(), {"description": "咖啡店"})
    assert action["action_type"] == "observe"
    assert len(agent.last_tool_calls) == 1
    assert agent.last_tool_calls[0].tool_name == "query_relations"
    assert agent.last_tool_calls[0].ok


def test_budget_exhaustion_forces_silence(monkeypatch):
    agent = _make_agent()
    monkeypatch.setattr(agent.settings, "tool_max_calls_per_turn", 1)
    # mock 默认永远返回 query_relations 工具调用（脚本外默认行为是 submit_action，
    # 这里用脚本让它一直调感知工具）
    backend = get_backend()
    backend.set_script([
        LLMResponse(tool_calls=[ToolCall(id=f"t{i}", name="observe_world", arguments={})])
        for i in range(5)
    ])
    action = agent.decide("场景", _world(), {"description": "咖啡店"})
    assert action["action_type"] == "silence"


def test_act_returns_event_and_enforces_boundary(mock_backend):
    agent = _make_agent()
    event = agent.act(_world(), {"description": "咖啡店"})
    assert event.actor == "艾莉丝"
    assert event.action_type in {"speak", "move", "use", "observe", "silence"}
    assert event.importance == 0.5  # 未打分前默认


def test_perceive_contains_context(mock_backend):
    agent = _make_agent()
    perception = agent.perceive(_world(), {"description": "咖啡店"})
    assert "咖啡店" in perception
    assert "在场角色" in perception
