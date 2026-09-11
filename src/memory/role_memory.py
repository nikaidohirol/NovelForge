"""角色链记忆（MENTOR 式）：每角色独立 collection + importance 淘汰。"""
from __future__ import annotations

import uuid

from config.settings import get_settings
from src.memory.vector_store import get_embedding_function, get_vector_store, new_id
from src.models.event import MemoryEntry
from src.utils.logger import get_logger

logger = get_logger(__name__)


class RoleMemory:
    def __init__(self, character: str):
        self.character = character
        self.settings = get_settings()
        self.store = get_vector_store(f"role_{character}")
        self.embed_fn = get_embedding_function()

    def add(self, entry: MemoryEntry) -> None:
        if self.store.count() >= self.settings.memory_max_entries:
            self.prune(self.character)
        emb = self.embed_fn.embed([entry.content])[0]
        self.store.add(
            ids=[entry.id],
            documents=[entry.content],
            metadatas=[{
                "character": entry.character,
                "turn": entry.turn,
                "importance": entry.importance,
            }],
            embeddings=[emb],
        )

    def retrieve(self, character: str, query: str, k: int = 5) -> list[MemoryEntry]:
        # owner 隔离：collection 本身即角色私有，此处再做字段校验双保险
        if character != self.character:
            logger.warning("RoleMemory(%s) 拒绝跨角色检索 %s", self.character, character)
            return []
        q = self.embed_fn.embed([query])[0]
        results = self.store.query(q, k=k, where={"character": character})
        return [
            MemoryEntry(
                id=r.id,
                character=character,
                content=r.document,
                turn=int(r.metadata.get("turn", 0)),
                importance=float(r.metadata.get("importance", 0.5)),
            )
            for r in results
        ]

    def prune(self, character: str) -> None:
        entries = self.store.all_entries()
        if len(entries) <= self.settings.memory_max_entries:
            return
        entries.sort(key=lambda x: float(x[2].get("importance", 0.5)))
        n_drop = max(1, int(len(entries) * self.settings.memory_prune_ratio))
        drop_ids = [e[0] for e in entries[:n_drop]]
        self.store.delete(drop_ids)
        logger.info("角色 %s 记忆淘汰 %d 条", character, len(drop_ids))

    def count(self) -> int:
        return self.store.count()


def make_entry(character: str, content: str, turn: int, importance: float) -> MemoryEntry:
    return MemoryEntry(id=new_id(), character=character, content=content,
                       turn=turn, importance=importance)
