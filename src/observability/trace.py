"""★ 聚焦点 D：可观测性 — Span / TraceManager（LangFuse | 本地 jsonl 双后端）。

span 层级约定：
    simulation(session_id)
    └── turn.{n}
        ├── agent.{name}.decide
        │   ├── llm.call
        │   └── tool.{tool_name}
        ├── boundary.check / boundary.regenerate
        ├── director.intervene
        └── rewrite.chapter

使用方式（自动父子嵌套，基于 contextvar 栈）：
    with tracer.span("turn.5", tags=["turn"]) as t:
        ...
        with tracer.span("agent.alice.decide") as t2:
            t2.set_output("...")
"""
from __future__ import annotations

import contextvars
import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from config.settings import get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

_current_span: contextvars.ContextVar[Optional["Span"]] = contextvars.ContextVar(
    "current_span", default=None
)


@dataclass
class Span:
    id: str
    name: str
    parent_id: str | None = None
    start_ts: float = 0.0
    end_ts: float | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    tags: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)
    input_summary: str = ""
    output_summary: str = ""
    # langfuse 后端内部句柄
    _native: Any = None

    @property
    def latency_ms(self) -> float:
        if self.end_ts is None:
            return 0.0
        return round((self.end_ts - self.start_ts) * 1000, 2)

    def set_output(self, summary: str, truncate: int = 300) -> None:
        self.output_summary = summary[:truncate]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "parent_id": self.parent_id,
            "name": self.name,
            "latency_ms": self.latency_ms,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "cost_usd": self.cost_usd,
            "tags": self.tags,
            "input": self.input_summary,
            "output": self.output_summary,
            "meta": self.meta,
        }


class _Backend:
    def start(self, span: Span) -> None: ...
    def end(self, span: Span) -> None: ...
    def flush(self) -> None: ...


class LocalJSONLBackend(_Backend):
    """本地 jsonl 兜底后端：每行一个 span。"""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def start(self, span: Span) -> None:
        return  # 仅在结束时落盘

    def end(self, span: Span) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(span.to_dict(), ensure_ascii=False) + "\n")

    def flush(self) -> None:
        return


class LangfuseBackend(_Backend):
    """LangFuse 后端（懒加载；故障自动降级由 TraceManager 处理）。"""

    def __init__(self, public_key: str, secret_key: str, host: str):
        from langfuse import Langfuse  # 延迟导入，未安装/未配置时不阻塞

        self.client = Langfuse(public_key=public_key, secret_key=secret_key, host=host)

    def start(self, span: Span) -> None:
        from langfuse import get_client

        client = get_client()
        kwargs = dict(name=span.name, tags=span.tags, input=span.input_summary or None)
        if span.parent_id and span.parent_id.startswith("lf_"):
            kwargs["parent_observation_id"] = span.parent_id
        obs = client.start_observation(**kwargs)
        span._native = obs
        span.id = f"lf_{obs.id}"

    def end(self, span: Span) -> None:
        if span._native is None:
            return
        span._native.end(
            output=span.output_summary or None,
            metadata={"latency_ms": span.latency_ms, **span.meta},
            usage={"input": span.tokens_in, "output": span.tokens_out},
        )

    def flush(self) -> None:
        try:
            self.client.flush()
        except Exception as e:  # pragma: no cover
            logger.warning("langfuse flush 失败: %s", e)


class TraceManager:
    """双后端 Trace 管理器。LangFuse 密钥缺失时自动降级本地 jsonl，不崩溃。"""

    def __init__(self) -> None:
        self.settings = get_settings()
        self._backend: _Backend | None = None
        self._init_backend()

    def _init_backend(self) -> None:
        mode = self.settings.trace_backend
        if mode in ("langfuse",) or (
            mode == "auto"
            and self.settings.langfuse_public_key
            and self.settings.langfuse_secret_key
        ):
            try:
                self._backend = LangfuseBackend(
                    self.settings.langfuse_public_key,
                    self.settings.langfuse_secret_key,
                    self.settings.langfuse_host,
                )
                logger.info("Trace 后端: langfuse")
                return
            except Exception as e:
                logger.warning("LangFuse 初始化失败，降级本地 jsonl: %s", e)
        self._backend = LocalJSONLBackend(
            Path(self.settings.chroma_persist_dir).parent / "logs" / "traces.jsonl"
        )
        logger.info("Trace 后端: local jsonl")

    # ---- 核心接口 ----
    def span(self, name: str, tags: list[str] | None = None, **meta: Any) -> Span:
        parent = _current_span.get()
        span = Span(
            id=uuid.uuid4().hex[:16],
            name=name,
            parent_id=parent.id if parent else None,
            start_ts=time.time(),
            tags=tags or [],
            meta=meta,
        )
        try:
            self._backend.start(span)
        except Exception as e:
            logger.warning("span start 失败（忽略）: %s", e)
        return span

    def end(self, span: Span) -> None:
        span.end_ts = time.time()
        try:
            self._backend.end(span)
        except Exception as e:
            logger.warning("span end 失败（忽略）: %s", e)

    def flush(self) -> None:
        try:
            self._backend.flush()
        except Exception as e:
            logger.warning("trace flush 失败（忽略）: %s", e)

    # ---- context manager：自动父子嵌套 ----
    def trace(self, name: str, tags: list[str] | None = None, **meta: Any) -> "_SpanContext":
        return _SpanContext(self, name, tags, meta)

    def read_all(self, limit: int = 2000) -> list[dict]:
        """读取本地 jsonl 的 span 列表（供 trace API 使用；langfuse 模式返回空）。"""
        backend = self._backend
        if isinstance(backend, LocalJSONLBackend) and backend.path.exists():
            lines = backend.path.read_text(encoding="utf-8").splitlines()[-limit:]
            out = []
            for ln in lines:
                try:
                    out.append(json.loads(ln))
                except json.JSONDecodeError:
                    continue
            return out
        return []


class _SpanContext:
    def __init__(self, tm: TraceManager, name: str, tags, meta) -> None:
        self.tm = tm
        self.name = name
        self.tags = tags
        self.meta = meta
        self.span: Span | None = None
        self._token = None

    def __enter__(self) -> Span:
        self.span = self.tm.span(self.name, self.tags, **self.meta)
        self._token = _current_span.set(self.span)
        return self.span

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.span:
            if exc is not None:
                self.span.meta["error"] = str(exc)[:300]
            self.tm.end(self.span)
        if self._token is not None:
            _current_span.reset(self._token)


_tracer: TraceManager | None = None


def get_tracer() -> TraceManager:
    global _tracer
    if _tracer is None:
        _tracer = TraceManager()
    return _tracer


def reset_tracer() -> None:
    """测试用：重置单例。"""
    global _tracer
    _tracer = None
