"""张力计算测试：边界 + 单调性 + 权重。"""
from __future__ import annotations

from src.models.character import CharacterState
from src.models.event import Event
from src.models.world import WorldState
from src.tension.calculator import DEFAULT_WEIGHTS, TensionCalculator


def _world(affinity: float = 0.0, goals: list[str] | None = None) -> WorldState:
    state = CharacterState(name="艾莉丝", affinity={"鲍勃": affinity},
                           active_goals=goals or [])
    return WorldState(turn=3, location="咖啡店", characters={"艾莉丝": state})


def test_bounds():
    calc = TensionCalculator()
    assert 0.0 <= calc.compute(_world(), []) <= 10.0
    assert 0.0 <= calc.compute(_world(affinity=3.0), []) <= 10.0


def test_weights_normalized():
    calc = TensionCalculator({"delta_affinity": 1.0})
    assert abs(sum(calc.w.values()) - 1.0) < 1e-9


def test_affinity_delta_increases_tension():
    calc = TensionCalculator()
    low = calc.compute(_world(affinity=0.0), [])
    high = calc.compute(_world(affinity=0.9), [])
    assert high > low


def test_goal_conflict_detected():
    calc = TensionCalculator()
    conflict_world = _world(goals=["保护地下组织的账本", "夺取账本并摧毁保护"])
    no_conflict_world = _world(goals=["喝咖啡", "看报纸"])
    assert calc._compute_goal_conflict(conflict_world) >= 0.0
    assert calc._compute_goal_conflict(no_conflict_world) == 0.0


def test_event_affects_score():
    calc = TensionCalculator()
    events = [Event(turn=1, actor="A", action_type="speak", content=f"独白{n}")
              for n in range(3)]
    assert calc.compute(_world(), events) >= 0.0
    assert abs(sum(DEFAULT_WEIGHTS.values()) - 1.0) < 1e-9
