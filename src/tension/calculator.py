"""可计算化张力公式（聚焦点 A 的基础）：

    张力 = w1 * 关系值变化幅度 + w2 * 目标冲突程度
         + w3 * 信息不对称程度 + w4 * 事件新颖度

每个分量独立归一化到 [0,1]，加权后映射到 [0,10]，可解释、可单测。
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from config.settings import get_settings

if TYPE_CHECKING:
    from src.models.event import Event
    from src.models.world import WorldState

DEFAULT_WEIGHTS = {"delta_affinity": 0.3, "goal_conflict": 0.3,
                   "info_asymmetry": 0.2, "novelty": 0.2}


class TensionCalculator:
    def __init__(self, weights: dict[str, float] | None = None):
        self.w = dict(DEFAULT_WEIGHTS)
        if weights:
            self.w.update(weights)
        total = sum(self.w.values()) or 1.0
        self.w = {k: v / total for k, v in self.w.items()}

    def compute(self, world: "WorldState", recent_events: list["Event"]) -> float:
        tension = 10.0 * (
            self.w["delta_affinity"] * self._compute_affinity_delta(world)
            + self.w["goal_conflict"] * self._compute_goal_conflict(world)
            + self.w["info_asymmetry"] * self._compute_info_asymmetry(world)
            + self.w["novelty"] * self._compute_novelty(recent_events, world)
        )
        return round(min(10.0, max(0.0, tension)), 3)

    # ---- 分量 1：关系值变化幅度（最近一回合的平均 |delta|） ----
    def _compute_affinity_delta(self, world: "WorldState") -> float:
        if not world.characters:
            return 0.0
        deltas = []
        for state in world.characters.values():
            for v in state.affinity.values():
                deltas.append(abs(v))
        if not deltas:
            return 0.0
        return min(1.0, sum(deltas) / len(deltas) / 0.5)  # 0.5 幅度视为满格

    # ---- 分量 2：目标冲突程度（目标文本的词汇重叠对数 / 总对数） ----
    def _compute_goal_conflict(self, world: "WorldState") -> float:
        goals: list[str] = []
        for state in world.characters.values():
            goals.extend(state.active_goals or [])
        if len(goals) < 2:
            return 0.0
        conflict_pairs = 0
        total_pairs = 0
        for i in range(len(goals)):
            for j in range(i + 1, len(goals)):
                total_pairs += 1
                if self._opposed(goals[i], goals[j]):
                    conflict_pairs += 1
        return conflict_pairs / total_pairs if total_pairs else 0.0

    @staticmethod
    def _opposed(a: str, b: str) -> bool:
        """轻量对立判定：共享实体词 + 对立意图词共现。"""
        intent_neg = ["阻止", "破坏", "夺取", "隐瞒", "消灭", "抓住", "封口", "摧毁"]
        intent_pos = ["保护", "守护", "查明", "揭示", "救出", "逃走", "隐藏"]
        a_neg = any(w in a for w in intent_neg)
        a_pos = any(w in a for w in intent_pos)
        b_neg = any(w in b for w in intent_neg)
        b_pos = any(w in b for w in intent_pos)
        opposite_intent = (a_neg and b_pos) or (a_pos and b_neg)
        shared_entity = len(set(a) & set(b)) >= 2  # 至少共享两个汉字
        return opposite_intent and shared_entity

    # ---- 分量 3：信息不对称（角色间 unknown_facts 覆盖差 → 用 flags 与关系值差近似：
    #      每个角色「知道而他人不知道」的公开事件占比） ----
    def _compute_info_asymmetry(self, world: "WorldState") -> float:
        if len(world.characters) < 2 or not world.recent_events:
            return 0.0
        # 近似：最近事件数越多、角色情绪分歧越大 → 不对称越高（可解释启发式）
        emotions = {s.emotion for s in world.characters.values()}
        emotion_spread = min(1.0, (len(emotions) - 1) / 3)
        event_density = min(1.0, len(world.recent_events) / 20)
        return 0.5 * emotion_spread + 0.5 * event_density

    # ---- 分量 4：事件新颖度（最近 5 回合未见过的动作文本占比） ----
    def _compute_novelty(self, recent_events: list["Event"], world: "WorldState") -> float:
        if not recent_events:
            return 0.0
        seen = set(world.recent_events[:-len(recent_events)]) if world.recent_events else set()
        novel = sum(1 for e in recent_events if e.content not in seen)
        return min(1.0, novel / max(1, len(recent_events)))
