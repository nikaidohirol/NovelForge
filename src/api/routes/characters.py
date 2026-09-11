"""角色卡管理路由：data/characters 下的 JSON 文件。"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from config.settings import PROJECT_ROOT
from src.models.character import CharacterCard

router = APIRouter(prefix="/api/characters", tags=["characters"])

CHARACTERS_DIR = PROJECT_ROOT / "data" / "characters"


def _list_files() -> list[Path]:
    CHARACTERS_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(CHARACTERS_DIR.glob("*.json"))


@router.get("")
def list_characters() -> list[dict]:
    out = []
    for p in _list_files():
        try:
            card = CharacterCard.model_validate(json.loads(p.read_text(encoding="utf-8")))
            out.append(card.model_dump(mode="json"))
        except (ValidationError, json.JSONDecodeError) as e:
            out.append({"_file": p.name, "_error": str(e)[:200]})
    return out


@router.get("/{name}")
def get_character(name: str) -> dict:
    p = CHARACTERS_DIR / f"{name}.json"
    if not p.exists():
        # 按角色名查找
        for f in _list_files():
            try:
                card = CharacterCard.model_validate(json.loads(f.read_text(encoding="utf-8")))
                if card.name == name:
                    return card.model_dump(mode="json")
            except (ValidationError, json.JSONDecodeError):
                continue
        raise HTTPException(404, f"角色 {name} 不存在")
    return json.loads(p.read_text(encoding="utf-8"))


@router.post("")
def upload_character(payload: dict) -> dict:
    try:
        card = CharacterCard.model_validate(payload)
    except ValidationError as e:
        raise HTTPException(422, f"角色卡校验失败: {e.errors()[:3]}") from e
    CHARACTERS_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(ch for ch in card.name if ch.isalnum() or ch in "_- ")[:30] or "character"
    path = CHARACTERS_DIR / f"{safe}.json"
    path.write_text(card.model_dump_json(indent=2), encoding="utf-8")
    return {"saved": str(path.name), "name": card.name}


@router.delete("/{name}")
def delete_character(name: str) -> dict:
    p = CHARACTERS_DIR / f"{name}.json"
    if p.exists():
        p.unlink()
        return {"deleted": name}
    raise HTTPException(404, f"角色 {name} 不存在")
