"""干预策略测试（聚焦点 A）。"""
from __future__ import annotations

import pytest

from src.models.character import CharacterState
from src.models.world import WorldState
from src.strategies.base import INTERVENTION_TYPES
from src.strategies.periodic import PeriodicStrategy, load_strategy
from src.strategies.rate_based import RateBasedStrategy
from src.strategies.threshold import ThresholdStrategy


def _world(turn: int = 0) -> WorldState:
    return WorldState(turn=turn, characters={"A": CharacterState(name="A")})


def test_threshold_needs_consecutive_low_turns():
    s = ThresholdStrategy(threshold=3.0, consecutive_turns=3)
    assert not s.should_intervene(_world(), [2.0, 2.0])
    assert not s.should_intervene(_world(), [2.0, 2.0, 5.0])
    assert s.should_intervene(_world(), [2.0, 2.5, 1.0])


def test_rate_based_triggers_on_flat_history():
    s = RateBasedStrategy(rate_threshold=0.05, consecutive_turns=3)
    flat = [4.0, 4.01, 4.0, 4.005]
    moving = [4.0, 4.4, 4.0, 4.5]
    assert s.should_intervene(_world(), flat)
    assert not s.should_intervene(_world(), moving)


def test_periodic_every_k_turns():
    s = PeriodicStrategy(interval=8)
    assert not s.should_intervene(_world(7), [])
    assert s.should_intervene(_world(8), [])
    assert not s.should_intervene(_world(9), [])
    assert s.select_intervention_type(_world(8)) in INTERVENTION_TYPES


def test_load_strategy():
    assert load_strategy("threshold").name == "threshold"
    assert load_strategy("rate_based").name == "rate_based"
    assert load_strategy("periodic").name == "periodic"
    with pytest.raises(ValueError):
        load_strategy("nope")


def test_intervention_types_complete():
    assert set(INTERVENTION_TYPES) == {
        "external_event", "secret_reveal", "deadline", "new_character"}
