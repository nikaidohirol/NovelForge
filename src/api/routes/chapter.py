"""章节路由：触发重写 + 获取章节。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.api.routes.simulation import _get_engine, sessions
from src.rewrite.coordinator import NarrativeCoordinator
from src.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/api/chapter", tags=["chapter"])

_chapters: dict[str, dict] = {}


@router.post("/rewrite")
async def rewrite(payload: dict) -> dict:
    session_id = payload.get("session_id", "")
    pov = payload.get("pov_character")
    if session_id in sessions:
        engine = _get_engine(session_id)
        logs = engine.scene_logs
        cards = engine.cards
        if not pov:
            pov = next(iter(cards), "")
    else:
        raise HTTPException(404, f"会话 {session_id} 不存在")
    if not logs:
        raise HTTPException(422, "该会话还没有互动日志，请先运行模拟")
    chapter = NarrativeCoordinator().rewrite(logs, pov, cards)
    _chapters[f"{session_id}_{pov}"] = chapter.model_dump(mode="json")
    return _chapters[f"{session_id}_{pov}"]


@router.get("/{chapter_id}")
async def get_chapter(chapter_id: str) -> dict:
    if chapter_id in _chapters:
        return _chapters[chapter_id]
    raise HTTPException(404, f"章节 {chapter_id} 不存在")
