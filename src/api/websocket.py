"""WebSocket 管理器：实时互动流推送 + 控制指令 + HITL 确认。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.engine.simulation import SimulationEngine
from src.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

# session_id -> {"engine": SimulationEngine, "clients": list[WebSocket], "task": asyncio.Task}
sessions: dict[str, dict] = {}


async def _broadcast(session: dict, message: dict) -> None:
    dead = []
    for client in session["clients"]:
        try:
            await client.send_json(message)
        except Exception:
            dead.append(client)
    for client in dead:
        if client in session["clients"]:
            session["clients"].remove(client)


def _make_broadcast(session: dict):
    async def broadcast(message: dict) -> None:
        await _broadcast(session, message)
    return broadcast


def _make_confirm(session: dict):
    """HITL 确认门：广播预览 → 等待前端 confirm_intervention。"""
    async def confirm(preview: dict) -> bool:
        session["pending_confirmation"] = True
        session["approved"] = False
        await _broadcast(session, {
            "type": "intervention_confirm_required",
            "turn": preview.get("turn"),
            "intervention": preview,
        })
        while session.get("pending_confirmation") and not session.get("stopped"):
            await asyncio.sleep(0.1)
        return bool(session.get("approved"))
    return confirm


@router.websocket("/ws/simulation/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = sessions.get(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": f"会话 {session_id} 不存在，请先 POST /api/simulation/start"})
        await websocket.close()
        return

    engine: SimulationEngine = session["engine"]
    session["clients"].append(websocket)
    # 注入广播 / 确认回调
    if engine.broadcast_fn is None:
        engine.broadcast_fn = _make_broadcast(session)
    if engine.confirm_fn is None and engine.settings.human_confirm_intervention:
        engine.confirm_fn = _make_confirm(session)

    # 首个客户端连接时启动引擎任务
    if session.get("task") is None or session["task"].done():
        session["task"] = asyncio.create_task(engine.run())
        session.setdefault("stopped", False)

    try:
        while True:
            data = await websocket.receive_json()
            mtype = data.get("type")
            if mtype == "pause":
                engine.pause()
            elif mtype == "resume":
                engine.resume()
            elif mtype == "step":
                engine.request_step()
            elif mtype == "stop":
                session["stopped"] = True
                engine.stop()
            elif mtype == "set_speed":
                engine.speed = float(data.get("speed", 1.0))
            elif mtype == "confirm_intervention":
                session["approved"] = bool(data.get("approved", False))
                session["pending_confirmation"] = False
            else:
                await websocket.send_json({"type": "error", "message": f"未知消息类型: {mtype}"})
    except WebSocketDisconnect:
        if websocket in session["clients"]:
            session["clients"].remove(websocket)
    except Exception as e:
        logger.warning("WebSocket 异常: %s", e)
        if websocket in session["clients"]:
            session["clients"].remove(websocket)
