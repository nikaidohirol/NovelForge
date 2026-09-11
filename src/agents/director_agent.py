"""导演 Agent（聚焦点 A）：张力评估 + 策略干预 + 场景调度。"""
from __future__ import annotations

from src.agents.base import BaseAgent
from src.observability.trace import get_tracer
from src.models.character import CharacterCard
from src.models.event import Event
from src.models.world import WorldState
from src.strategies.base import InterventionStrategy
from src.tension.calculator import TensionCalculator
from src.utils.llm import call_llm_json
from src.utils.logger import get_logger

logger = get_logger(__name__)

FALLBACK_INTERVENTIONS = {
    "external_event": "一阵冷风裹着雨点灌进店里，门被撞开——一个浑身湿透的陌生人站在门口，目光扫过每一个人。",
    "secret_reveal": "墙角老旧收音机突然自己响了，播出的却是三个月前应该已经销毁的一段录音。",
    "deadline": "所有人的手机同时震动：屏幕上只有一行字——『午夜之前，把东西放回去。』",
    "new_character": "门铃轻响，一位穿着不合时宜的风衣的年轻女子走进店里，径直坐到了角落的位置。",
}


class DirectorAgent(BaseAgent):
    def __init__(self, strategy: InterventionStrategy,
                 card: CharacterCard | None = None):
        dummy = card or CharacterCard(
            data={"name": "导演", "description": "系统导演", "personality": "克制"})
        super().__init__(dummy)
        self.strategy = strategy
        self.calculator = TensionCalculator()

    # ---- 张力评估（纯可计算，无 LLM） ----
    def evaluate_tension(self, world: WorldState, recent_events: list[Event]) -> float:
        return self.calculator.compute(world, recent_events)

    # ---- 是否干预 ----
    def should_intervene(self, world: WorldState) -> bool:
        return self.strategy.should_intervene(world, world.tension_history)

    # ---- 生成干预（记录理由，LLM 生成内容，fallback 用预制文本） ----
    def generate_intervention(self, world: WorldState) -> dict:
        with self.trace("director.intervene", tags=["director"],
                        turn=world.turn) as span:
            itype = self.strategy.select_intervention_type(world)
            goal_texts = [g for s in world.characters.values() for g in (s.active_goals or [])]
            prompt = (
                f"你是叙事导演。当前场景：{world.location}（{world.time_of_day}），第 {world.turn} 轮。\n"
                f"在场角色：{'、'.join(world.characters.keys())}\n"
                f"角色目标：{'；'.join(goal_texts) or '未知'}\n"
                f"张力曲线（最近）：{[round(t, 1) for t in world.tension_history[-6:]]}\n\n"
                f"请注入一个「{itype}」类型的干预事件，推动剧情。\n"
                f'输出 JSON：{{"reason": "选择该干预的理由（一句话）", "content": "干预事件描述（60字内，有画面感）"}}'
            )
            result = call_llm_json(prompt, tag="intervention")
            content = str(result.get("content", "")) if isinstance(result, dict) else ""
            reason = str(result.get("reason", "")) if isinstance(result, dict) else ""
            if not content:
                content = FALLBACK_INTERVENTIONS.get(itype, FALLBACK_INTERVENTIONS["external_event"])
                reason = reason or f"LLM 生成失败，使用默认干预（{itype}）"
            intervention = {
                "type": itype,
                "strategy": self.strategy.name,
                "reason": reason,
                "content": content,
                "turn": world.turn,
            }
            span.set_output(content[:200])
        return intervention

    # ---- 场景调度（最小可行：全员在场） ----
    def schedule_next_scene(self, world: WorldState, cards: dict[str, CharacterCard]) -> dict:
        return {
            "location": world.location,
            "participants": list(world.characters.keys()),
            "description": f"{world.location}，{world.time_of_day}。",
            "turn": world.turn,
        }
