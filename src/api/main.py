"""FastAPI 入口：uvicorn src.api.main:app --reload --port 8000"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.settings import get_settings
from src.api.routes import chapter, characters, experiments, simulation
from src.api.websocket import router as ws_router

settings = get_settings()

app = FastAPI(
    title="NovelForge API",
    description="多 Agent 轻小说生成系统：角色 Agent 自主互动 + 导演干预 + 知识边界硬约束 + 工具调用 + 全链路 Trace",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(characters.router)
app.include_router(simulation.router)
app.include_router(chapter.router)
app.include_router(experiments.router)
app.include_router(ws_router)


@app.get("/")
async def root() -> dict:
    return {
        "name": "NovelForge",
        "version": "2.0.0",
        "docs": "/docs",
        "strategy": settings.intervention_strategy,
        "llm_backend": settings.llm_backend,
    }
