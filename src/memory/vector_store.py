"""向量存储 + embedding 抽象。

- embedding：OpenAI（若配置 Key）→ 本地确定性 hash（中文 char 3-gram，测试/离线用）
- store：ChromaDB（若可导入且 vector_store=auto/chroma）→ 纯 Python 余弦 NaiveVectorStore

NaiveVectorStore 保证零依赖测试与 ChromaDB 故障时的降级，接口与 Chroma 封装一致。
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from pathlib import Path
from typing import Any, Protocol

from config.settings import PROJECT_ROOT, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

EMBED_DIM = 256


# ---------------------------------------------------------------- embedding
class EmbeddingFunction(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbedding:
    """确定性 char 3-gram hash embedding。中文场景下作为词法相似度近似，
    保证测试可离线运行、结果可复现。"""

    def embed(self, texts: list[str]) -> list[list[float]]:
        vecs = []
        for text in texts:
            v = [0.0] * EMBED_DIM
            cleaned = re.sub(r"\s+", "", text.lower())
            grams = [cleaned[i : i + 3] for i in range(max(1, len(cleaned) - 2))]
            if not grams:
                grams = [cleaned or " "]
            for g in grams:
                h = int(hashlib.md5(g.encode("utf-8")).hexdigest(), 16)
                v[h % EMBED_DIM] += 1.0
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            vecs.append([x / norm for x in v])
        return vecs


class OpenAIEmbedding:
    def __init__(self) -> None:
        from openai import OpenAI

        s = get_settings()
        self.client = OpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url)
        self.model = "text-embedding-3-small"

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = self.client.embeddings.create(model=self.model, input=texts)
        return [d.embedding for d in resp.data]


def cosine(a: list[float], b: list[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(x * x for x in b)) or 1e-9
    return num / (na * nb)


def get_embedding_function() -> EmbeddingFunction:
    s = get_settings()
    if s.embedding_backend == "openai" or (
        s.embedding_backend == "auto" and s.openai_api_key and s.llm_backend != "mock"
    ):
        try:
            return OpenAIEmbedding()
        except Exception as e:
            logger.warning("OpenAI embedding 不可用，降级 hash embedding: %s", e)
    return HashEmbedding()


# ---------------------------------------------------------------- vector store
class QueryResult:
    def __init__(self, id: str, document: str, metadata: dict, score: float):
        self.id, self.document, self.metadata, self.score = id, document, metadata, score


class VectorStore(Protocol):
    def add(self, ids: list[str], documents: list[str],
            metadatas: list[dict], embeddings: list[list[float]]) -> None: ...
    def query(self, query_embedding: list[float], k: int = 5,
              where: dict | None = None) -> list[QueryResult]: ...
    def count(self) -> int: ...
    def delete(self, ids: list[str]) -> None: ...
    def all_entries(self) -> list[tuple[str, str, dict]]: ...


class NaiveVectorStore:
    """纯 Python 余弦检索（可持久化到 jsonl）。"""

    def __init__(self, persist_path: Path | None = None):
        self.persist_path = persist_path
        self._ids: list[str] = []
        self._docs: list[str] = []
        self._metas: list[dict] = []
        self._vecs: list[list[float]] = []
        if persist_path and persist_path.exists():
            self._load()

    def _load(self) -> None:
        try:
            rows = json.loads(self.persist_path.read_text(encoding="utf-8"))
            for r in rows:
                self._ids.append(r["id"]); self._docs.append(r["doc"])
                self._metas.append(r["meta"]); self._vecs.append(r["vec"])
        except (json.JSONDecodeError, KeyError, OSError) as e:
            logger.warning("naive store 加载失败（忽略）: %s", e)

    def _save(self) -> None:
        if not self.persist_path:
            return
        self.persist_path.parent.mkdir(parents=True, exist_ok=True)
        rows = [{"id": i, "doc": d, "meta": m, "vec": v}
                for i, d, m, v in zip(self._ids, self._docs, self._metas, self._vecs)]
        self.persist_path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def add(self, ids, documents, metadatas, embeddings) -> None:
        self._ids.extend(ids); self._docs.extend(documents)
        self._metas.extend(metadatas); self._vecs.extend(embeddings)
        self._save()

    def query(self, query_embedding, k=5, where=None) -> list[QueryResult]:
        scored = []
        for i, vec in enumerate(self._vecs):
            if where and any(self._metas[i].get(k) != v for k, v in where.items()):
                continue
            scored.append((cosine(query_embedding, vec), i))
        scored.sort(key=lambda x: -x[0])
        return [
            QueryResult(self._ids[i], self._docs[i], self._metas[i], s)
            for s, i in scored[:k]
        ]

    def count(self) -> int:
        return len(self._ids)

    def delete(self, ids: list[str]) -> None:
        drop = set(ids)
        keep = [i for i, x in enumerate(self._ids) if x not in drop]
        self._ids = [self._ids[i] for i in keep]
        self._docs = [self._docs[i] for i in keep]
        self._metas = [self._metas[i] for i in keep]
        self._vecs = [self._vecs[i] for i in keep]
        self._save()

    def all_entries(self) -> list[tuple[str, str, dict]]:
        return list(zip(self._ids, self._docs, self._metas))


class ChromaVectorStore:
    """ChromaDB 封装（每个 collection 独立）。"""

    def __init__(self, collection_name: str, persist_dir: str, embed_fn: EmbeddingFunction):
        import chromadb

        self.embed_fn = embed_fn
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.collection = self.client.get_or_create_collection(collection_name)

    def add(self, ids, documents, metadatas, embeddings) -> None:
        self.collection.upsert(ids=ids, documents=documents,
                               metadatas=metadatas, embeddings=embeddings)

    def query(self, query_embedding, k=5, where=None) -> list[QueryResult]:
        res = self.collection.query(query_embeddings=[query_embedding], n_results=k,
                                    where=where or None)
        out = []
        for i in range(len(res["ids"][0])):
            dist = res["distances"][0][i] if res["distances"] else 0.0
            out.append(QueryResult(res["ids"][0][i], res["documents"][0][i],
                                   dict(res["metadatas"][0][i]), 1.0 - dist))
        return out

    def count(self) -> int:
        return self.collection.count()

    def delete(self, ids: list[str]) -> None:
        if ids:
            self.collection.delete(ids=ids)

    def all_entries(self) -> list[tuple[str, str, dict]]:
        got = self.collection.get()
        return list(zip(got["ids"], got["documents"],
                        [dict(m) for m in got["metadatas"]]))


def _safe_collection_name(name: str) -> str:
    """ChromaDB 仅接受 ASCII 集合名；中文角色名映射为确定性 hash 名。"""
    import hashlib as _hl
    import re as _re

    if _re.fullmatch(r"[a-zA-Z0-9_\-]{3,512}", name):
        return name
    return f"nf_{_hl.md5(name.encode('utf-8')).hexdigest()[:12]}"


def get_vector_store(collection_name: str) -> VectorStore:
    s = get_settings()
    embed_fn = get_embedding_function()
    safe_name = _safe_collection_name(collection_name)
    if s.vector_store in ("chroma", "auto"):
        try:
            return ChromaVectorStore(safe_name, s.chroma_persist_dir, embed_fn)
        except Exception as e:
            logger.warning("ChromaDB 不可用，降级 NaiveVectorStore: %s", e)
    persist = PROJECT_ROOT / s.chroma_persist_dir / f"naive_{safe_name}.json"
    return NaiveVectorStore(persist)


def new_id() -> str:
    return uuid.uuid4().hex[:16]
