"""模拟控制路由：start / pause / resume / step / stop / status / tools / trace。"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from config.settings import PROJECT_ROOT, get_settings
from src.engine.simulation import SimulationEngine
from src.models.character import CharacterCard
from src.api.websocket import sessions

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

CHARACTERS_DIR = PROJECT_ROOT / "data" / "characters"
SCENARIOS_DIR = PROJECT_ROOT / "data" / "scenarios"


def _load_cards(names: list[str]) -> list[CharacterCard]:
    cards = []
    for f in sorted(CHARACTERS_DIR.glob("*.json")):
        try:
            card = CharacterCard.model_validate(json.loads(f.read_text(encoding="utf-8")))
            if not names or card.name in names:
                cards.append(card)
        except (ValidationError, json.JSONDecodeError):
            continue
    return cards


@router.get("/scenarios")
def list_scenarios() -> list[dict]:
    SCENARIOS_DIR.mkdir(parents=True, exist_ok=True)
    return [json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(SCENARIOS_DIR.glob("*.json"))]


@router.post("/start")
async def start_simulation(payload: dict) -> dict:
    names = payload.get("characters") or []
    scenario = payload.get("scenario") or {}
    if isinstance(scenario, str):
        p = SCENARIOS_DIR / f"{scenario}.json"
        if not p.exists():
            raise HTTPException(404, f"场景 {scenario} 不存在")
        scenario = json.loads(p.read_text(encoding="utf-8"))
    cards = _load_cards(names if names else [])
    if len(cards) < 2:
        raise HTTPException(422, "至少需要 2 张有效角色卡")
    session_id = payload.get("session_id") or f"sim_{int(__import__('time').time())}"
    engine = SimulationEngine(
        cards, scenario, session_id=session_id,
        strategy_name=payload.get("strategy"),
        max_turns=payload.get("max_turns"),
        broadcast=None,  # WebSocket 连接建立后注入
    )
    sessions[session_id] = {"engine": engine, "clients": []}
    return {"session_id": session_id, "characters": [c.name for c in cards],
            "strategy": engine.strategy_name}


@router.post("/{session_id}/pause")
async def pause(session_id: str) -> dict:
    engine = _get_engine(session_id)
    engine.pause()
    return {"ok": True, "status": engine.status}


@router.post("/{session_id}/resume")
async def resume(session_id: str) -> dict:
    engine = _get_engine(session_id)
    engine.resume()
    return {"ok": True, "status": engine.status}


@router.post("/{session_id}/step")
async def step(session_id: str) -> dict:
    engine = _get_engine(session_id)
    engine.request_step()
    return {"ok": True, "status": engine.status}


@router.post("/{session_id}/stop")
async def stop(session_id: str) -> dict:
    engine = _get_engine(session_id)
    engine.stop()
    return {"ok": True, "status": engine.status}


@router.get("/{session_id}/status")
async def status(session_id: str) -> dict:
    return _get_engine(session_id).status_info


@router.get("/{session_id}/tools")
async def tool_calls(session_id: str) -> list[dict]:
    """工具调用记录（聚焦点 C）。"""
    from config.settings import PROJECT_ROOT

    p = PROJECT_ROOT / "logs" / "tool_calls.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        # 该 session 的记录以 turn 无法区分 session，近似全量返回最近记录
        out.append(record)
    return out[-200:]


@router.get("/{session_id}/trace")
async def trace_summary(session_id: str) -> dict:
    """Trace 摘要（span 树 + 成本统计，聚焦点 D）。"""
    from src.observability.cost import get_tracker
    from src.observability.trace import get_tracer

    spans = get_tracer().read_all(limit=800)
    related = [s for s in spans
               if session_id in s.get("name", "") or session_id in json.dumps(s.get("meta", {}))]
    return {
        "session_id": session_id,
        "spans": (related or spans)[-300:],
        "cost": get_tracker().summary(group_by="tag"),
    }


def _get_engine(session_id: str) -> SimulationEngine:
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"会话 {session_id} 不存在")
    return session["engine"]
