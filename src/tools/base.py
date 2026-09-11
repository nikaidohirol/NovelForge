"""★ 聚焦点 C：工具调用层 — Tool 抽象 + ToolRegistry（白名单 / 预算 / trace / 落盘）。

关键约束（见文档 §4.10 / §9.11-12）：
- 角色工具一律只读；写世界状态只属于引擎/导演
- execute 前做 白名单 / JSON Schema 参数 / owner 权限 三重校验
- 每次调用产生 trace span（tool.{name}）并写 logs/tool_calls.jsonl
- 异常捕获 → ok=False，不抛出
"""
from __future__ import annotations

import json
import time
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, Any

from config.settings import PROJECT_ROOT, get_settings
from src.models.tool import ToolCallRecord
from src.observability.trace import get_tracer
from src.utils.logger import get_logger

if TYPE_CHECKING:
    import networkx as nx

logger = get_logger(__name__)


def _log_tool_call(record: ToolCallRecord) -> None:
    try:
        p = PROJECT_ROOT / "logs" / "tool_calls.jsonl"
        p.parent.mkdir(exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record.model_dump(), ensure_ascii=False) + "\n")
    except OSError:
        pass


class Tool(ABC):
    name: str = ""
    description: str = ""
    parameters: dict = {"type": "object", "properties": {}, "required": []}

    @abstractmethod
    def run(self, owner: str, **kwargs: Any) -> dict:
        """owner 为发起调用的角色名，用于权限隔离。返回 JSON 可序列化 dict。"""

    def validate_args(self, arguments: dict) -> str | None:
        """轻量 JSON Schema 校验：required + 类型。"""
        props = self.parameters.get("properties", {})
        for req in self.parameters.get("required", []):
            if req not in arguments:
                return f"缺少必填参数: {req}"
        for key, value in arguments.items():
            if key not in props:
                return f"未知参数: {key}"
            expected = props[key].get("type")
            if expected == "string" and not isinstance(value, str):
                return f"参数 {key} 应为 string"
            if expected == "integer" and not isinstance(value, int):
                return f"参数 {key} 应为 integer"
        return None


class ToolRegistry:
    """只读工具白名单注册表。"""

    def __init__(self, tools: list[Tool]):
        self.tools: dict[str, Tool] = {t.name: t for t in tools}

    def openai_schemas(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in self.tools.values()
        ]

    def execute(self, tool_call, owner: str, turn: int) -> ToolCallRecord:
        """执行工具调用（tool_call: src.utils.llm.ToolCall）。"""
        settings = get_settings()
        tracer = get_tracer()
        record = ToolCallRecord(
            id=tool_call.id or uuid.uuid4().hex[:8],
            turn=turn,
            character=owner,
            tool_name=tool_call.name,
            arguments=dict(tool_call.arguments),
            result_summary="",
            latency_ms=0.0,
            ok=False,
        )
        start = time.time()
        with tracer.trace(f"tool.{tool_call.name}", tags=["tool", "tool_call"],
                          owner=owner, turn=turn) as span:
            try:
                # 1. 白名单校验
                tool = self.tools.get(tool_call.name)
                if tool is None:
                    record.error = f"工具不在白名单: {tool_call.name}"
                else:
                    # 2. 参数校验
                    err = tool.validate_args(tool_call.arguments)
                    if err:
                        record.error = err
                    else:
                        # 3. 执行（工具内部负责 owner 权限校验）
                        result = tool.run(owner=owner, **tool_call.arguments)
                        record.ok = True
                        summary = json.dumps(result, ensure_ascii=False, default=str)
                        record.result_summary = summary[:200]
                        span.set_output(record.result_summary)
            except Exception as e:  # 工具异常不阻塞主流程
                record.error = f"{type(e).__name__}: {e}"
                logger.warning("工具 %s 执行异常: %s", tool_call.name, e)
            record.latency_ms = round((time.time() - start) * 1000, 2)
            span.meta["ok"] = record.ok
            if record.error:
                span.set_output(record.error[:200])
        _log_tool_call(record)
        return record


def truncate(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"
