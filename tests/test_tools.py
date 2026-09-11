"""工具调用层测试（聚焦点 C）：白名单 / 参数校验 / owner 隔离 / 记录。"""
from __future__ import annotations

from src.memory.role_memory import RoleMemory, make_entry
from src.models.character import CharacterCard
from src.tools.base import ToolRegistry
from src.tools.registry import build_default_tools
from src.utils.llm import ToolCall

CARD = CharacterCard.model_validate({
    "spec": "chara_card_v2", "spec_version": "2.0",
    "data": {"name": "艾莉丝", "description": "d", "personality": "p"},
    "relations": {"鲍勃": "警惕"},
})


def _registry_with_memory() -> tuple[ToolRegistry, dict]:
    memories = {"艾莉丝": RoleMemory("艾莉丝"), "鲍勃": RoleMemory("鲍勃")}
    memories["艾莉丝"].add(make_entry("艾莉丝", "哥哥留下的怀表藏在书店", 1, 0.8))

    class _Graph:
        def __init__(self):
            self._adj = {"艾莉丝": {"鲍勃": {"affinity": 0.5, "description": "警惕"}}}

        def __contains__(self, name):
            return name in self._adj

        def __getitem__(self, name):
            return self._adj[name]

    world_ref = {"world": None}
    registry = build_default_tools(memories, _Graph(), world_ref)
    return registry, memories


def test_openai_schemas():
    registry, _ = _registry_with_memory()
    schemas = registry.openai_schemas()
    names = {s["function"]["name"] for s in schemas}
    assert names == {"search_memory", "query_relations", "observe_world"}
    for s in schemas:
        assert s["type"] == "function"
        assert "parameters" in s["function"]


def test_whitelist_rejects_unknown_tool():
    registry, _ = _registry_with_memory()
    rec = registry.execute(ToolCall(id="x1", name="hack_world", arguments={}),
                           owner="艾莉丝", turn=1)
    assert not rec.ok
    assert "白名单" in rec.error


def test_argument_validation():
    registry, _ = _registry_with_memory()
    rec = registry.execute(
        ToolCall(id="x2", name="search_memory", arguments={"k": 5}),
        owner="艾莉丝", turn=1)
    assert not rec.ok
    assert "缺少必填参数" in rec.error


def test_owner_isolation():
    """鲍勃不能通过 search_memory 检索艾莉丝的记忆。"""
    registry, memories = _registry_with_memory()
    tool = registry.tools["search_memory"]
    result_bob = tool.run(owner="鲍勃", query="怀表")
    assert result_bob["memories"] == []

    result_alice = tool.run(owner="艾莉丝", query="怀表")
    assert any("怀表" in m["content"] for m in result_alice["memories"])


def test_role_memory_rejects_cross_character_retrieve():
    registry, memories = _registry_with_memory()
    assert memories["鲍勃"].retrieve("艾莉丝", "怀表") == []


def test_execute_success_records_latency():
    registry, _ = _registry_with_memory()
    rec = registry.execute(
        ToolCall(id="x3", name="search_memory", arguments={"query": "哥哥"}),
        owner="艾莉丝", turn=2)
    assert rec.ok
    assert rec.character == "艾莉丝"
    assert rec.latency_ms >= 0
    assert len(rec.result_summary) <= 200


def test_query_relations_readonly():
    registry, _ = _registry_with_memory()
    rec = registry.execute(
        ToolCall(id="x4", name="query_relations", arguments={"character": "艾莉丝"}),
        owner="艾莉丝", turn=1)
    assert rec.ok
    assert "鲍勃" in rec.result_summary
