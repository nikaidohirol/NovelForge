"""实验结果路由。"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from config.settings import PROJECT_ROOT

router = APIRouter(prefix="/api/experiments", tags=["experiments"])

RESULTS_DIR = PROJECT_ROOT / "output"


@router.get("/results")
async def results() -> dict:
    p = RESULTS_DIR / "results.json"
    if not p.exists():
        return {"available": False, "message": "尚无实验结果，请先运行 experiments/run_comparison.py"}
    return {"available": True, **json.loads(p.read_text(encoding="utf-8"))}


@router.get("/report")
async def report() -> dict:
    p = RESULTS_DIR / "report.md"
    if not p.exists():
        raise HTTPException(404, "尚无实验报告，请先运行 experiments/run_comparison.py")
    return {"report": p.read_text(encoding="utf-8")}
