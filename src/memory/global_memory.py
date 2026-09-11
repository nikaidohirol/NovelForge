"""全局链记忆：单一 collection 存公开事件，供叙事重写检索。"""
from __future__ import annotations

from src.memory.role_memory import make_entry
from src.memory.vector_store import get_embedding_function, get_vector_store
from src.models.event import Event, MemoryEntry


class GlobalMemory:
    def __init__(self):
        self.store = get_vector_store("global_public")
        self.embed_fn = get_embedding_function()

    def add(self, event: Event) -> None:
        entry = make_entry(
            character=event.actor,
            content=f"[{event.actor} · {event.action_type}] {event.content}",
            turn=event.turn,
            importance=event.importance,
        )
        emb = self.embed_fn.embed([entry.content])[0]
        self.store.add(
            ids=[entry.id],
            documents=[entry.content],
            metadatas=[{
                "character": event.actor,
                "turn": event.turn,
                "importance": event.importance,
                "action_type": event.action_type,
                "target": event.target or "",
            }],
            embeddings=[emb],
        )

    def retrieve(self, query: str, k: int = 10) -> list[MemoryEntry]:
        q = self.embed_fn.embed([query])[0]
        results = self.store.query(q, k=k)
        return [
            MemoryEntry(
                id=r.id,
                character=str(r.metadata.get("character", "")),
                content=r.document,
                turn=int(r.metadata.get("turn", 0)),
                importance=float(r.metadata.get("importance", 0.5)),
            )
            for r in results
        ]
