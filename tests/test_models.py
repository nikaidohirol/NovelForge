"""数据模型测试。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.models.character import CharacterCard, CharacterState
from src.models.claim import BoundaryViolation, Claim
from src.models.event import Event
from src.models.tool import ToolCallRecord
from src.models.world import WorldState

V2_CARD = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {"name": "测试", "description": "描述", "personality": "冷静"},
    "goals": ["目标A"],
    "unknown_facts": ["首领是谁"],
}


def test_v2_card_parse():
    card = CharacterCard.model_validate(V2_CARD)
    assert card.spec == "chara_card_v2"
    assert card.name == "测试"
    assert card.personality == "冷静"
    assert card.goals == ["目标A"]


def test_v2_card_requires_data_fields():
    bad = {"spec": "chara_card_v2", "data": {"name": "缺性格"}}
    with pytest.raises(ValidationError):
        CharacterCard.model_validate(bad)


def test_world_state_defaults():
    world = WorldState()
    assert world.turn == 0
    assert world.characters == {}
    assert world.tension_history == []


def test_character_state_defaults():
    state = CharacterState(name="艾莉丝")
    assert state.emotion == "neutral"
    assert state.affinity == {}


def test_event_and_claim_roundtrip():
    event = Event(turn=1, actor="艾莉丝", action_type="speak", content="……", target="鲍勃")
    assert event.model_dump()["target"] == "鲍勃"
    claim = Claim(subject="地下组织", relation="首领", object="鲍勃", raw_text="x")
    v = BoundaryViolation(turn=1, character="艾莉丝", claim=claim,
                          violation_type="direct_match", matched_unknown_fact="f")
    assert v.violation_type == "direct_match"


def test_tool_call_record():
    rec = ToolCallRecord(id="t1", turn=2, character="艾莉丝", tool_name="search_memory",
                         arguments={"query": "哥哥"}, result_summary="[]",
                         latency_ms=1.2, ok=True)
    assert rec.ok is True
