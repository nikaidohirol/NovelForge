"""统一 LLM 调用封装：OpenAI / Anthropic / Mock 三后端 + 重试 + fallback + trace/成本。

所有调用必须走本模块，保证：
- 每次调用产生 trace span（llm.call）
- token 消耗进 UsageTracker
- 调用日志落 logs/llm_calls.jsonl
- 失败返回 fallback 值而非崩溃
"""
from __future__ import annotations

import json
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from config.settings import PROJECT_ROOT, get_settings
from src.observability.cost import get_tracker
from src.observability.trace import get_tracer
from src.utils.logger import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------- 数据结构
@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class LLMResponse:
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    # 可直接 append 回 messages 的原始 assistant 消息（OpenAI 格式）
    assistant_message: Optional[dict] = None
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = ""
    backend: str = ""

    @property
    def parsed(self) -> dict:
        """尝试从 content 解析 JSON dict。"""
        return _extract_json(self.content) if self.content else {}


class LLMError(Exception):
    pass


def _extract_json(text: str) -> dict | list | None:
    """鲁棒 JSON 抽取：容忍代码围栏 / 前后缀文本。"""
    text = text.strip()
    text = re.sub(r"^```(json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == opener:
                depth += 1
            elif text[i] == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    return None


# ---------------------------------------------------------------- 后端
class LLMBackend:
    name = "base"

    def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        json_mode: bool = False,
        model: str | None = None,
        temperature: float | None = None,
    ) -> LLMResponse: ...


class OpenAIBackend(LLMBackend):
    name = "openai"

    def __init__(self) -> None:
        from openai import OpenAI

        s = get_settings()
        self.client = OpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url)

    def chat(self, messages, tools=None, json_mode=False, model=None, temperature=None):
        s = get_settings()
        kwargs: dict[str, Any] = dict(
            model=model or s.model_name,
            messages=messages,
            temperature=s.temperature if temperature is None else temperature,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        elif json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = self.client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        tool_calls = [
            ToolCall(
                id=tc.id,
                name=tc.function.name,
                arguments=json.loads(tc.function.arguments or "{}"),
            )
            for tc in (msg.tool_calls or [])
        ]
        usage = resp.usage
        return LLMResponse(
            content=msg.content or "",
            tool_calls=tool_calls,
            assistant_message=msg.model_dump(exclude_none=True),
            tokens_in=getattr(usage, "prompt_tokens", 0) or 0,
            tokens_out=getattr(usage, "completion_tokens", 0) or 0,
            model=kwargs["model"],
            backend=self.name,
        )


class AnthropicBackend(LLMBackend):
    name = "anthropic"

    def __init__(self) -> None:
        import anthropic

        s = get_settings()
        self.client = anthropic.Anthropic(api_key=s.anthropic_api_key)

    def _to_anthropic(self, messages: list[dict]) -> tuple[str, list[dict]]:
        system = ""
        out: list[dict] = []
        for m in messages:
            if m["role"] == "system":
                system += m["content"] + "\n"
            else:
                out.append({"role": m["role"], "content": m.get("content", "")})
        return system.strip(), out

    def chat(self, messages, tools=None, json_mode=False, model=None, temperature=None):
        s = get_settings()
        system, msgs = self._to_anthropic(messages)
        if json_mode:
            system += "\n只输出合法 JSON。"
        kwargs: dict[str, Any] = dict(
            model=model or s.model_name,
            max_tokens=2048,
            system=system,
            messages=msgs,
            temperature=s.temperature if temperature is None else temperature,
        )
        if tools:
            kwargs["tools"] = [
                {
                    "name": t["function"]["name"],
                    "description": t["function"]["description"],
                    "input_schema": t["function"]["parameters"],
                }
                for t in tools
            ]
        resp = self.client.messages.create(**kwargs)
        content = ""
        tool_calls = []
        for block in resp.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append(ToolCall(id=block.id, name=block.name, arguments=dict(block.input)))
        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            tokens_in=resp.usage.input_tokens,
            tokens_out=resp.usage.output_tokens,
            model=kwargs["model"],
            backend=self.name,
        )


class MockBackend(LLMBackend):
    """确定性 Mock 后端：测试 / 无 Key 演示用。

    - set_script() 可注入脚本化响应（依调用顺序弹出）
    - 默认行为按 prompt 关键词推断（claims / importance / delta / 干预 / submit_action）
    """

    name = "mock"

    def __init__(self) -> None:
        self._script: deque[Any] = deque()

    def set_script(self, responses: list[Any]) -> None:
        self._script.clear()
        self._script.extend(responses)

    def chat(self, messages, tools=None, json_mode=False, model=None, temperature=None):
        full_text = " ".join(str(m.get("content", "")) for m in messages)
        tool_names = {t["function"]["name"] for t in (tools or [])}

        if self._script:
            item = self._script.popleft()
            if isinstance(item, LLMResponse):
                return item
            if isinstance(item, (dict, list)):
                return LLMResponse(content=json.dumps(item, ensure_ascii=False))
            return LLMResponse(content=str(item))

        if "submit_action" in tool_names:
            # 角色决策：最后一次用户消息里带的记忆/场景 → 简单发言
            args = {"action_type": "speak", "content": "……好吧。", "target": None}
            if "鲍勃" in full_text and "艾莉丝" in full_text:
                args["target"] = "鲍勃"
            return LLMResponse(
                content="",
                tool_calls=[ToolCall(id=f"mock_{uuid.uuid4().hex[:6]}", name="submit_action", arguments=args)],
                tokens_in=len(full_text) // 3,
                tokens_out=20,
                model="mock",
                backend=self.name,
            )
        if json_mode:
            if "声明" in full_text:
                payload: Any = []
            elif "影响程度" in full_text:
                payload = {"score": 0.5}
            elif "关系值" in full_text or "delta" in full_text:
                payload = {"delta": 0.1}
            elif "干预" in full_text:
                payload = {
                    "type": "external_event",
                    "reason": "张力持续偏低",
                    "content": "一位浑身湿透的信使推门而入，带来一封火漆信。",
                }
            elif "评分" in full_text or "judge" in full_text.lower():
                payload = {"score": 4}
            else:
                payload = {}
            return LLMResponse(
                content=json.dumps(payload, ensure_ascii=False),
                tokens_in=len(full_text) // 3,
                tokens_out=15,
                model="mock",
                backend=self.name,
            )
        return LLMResponse(
            content="……（轻笑声）。" if len(full_text) > 500 else "嗯。",
            tokens_in=len(full_text) // 3,
            tokens_out=10,
            model="mock",
            backend=self.name,
        )


# ---------------------------------------------------------------- 后端工厂
_backend: LLMBackend | None = None


def get_backend() -> LLMBackend:
    global _backend
    if _backend is not None:
        return _backend
    s = get_settings()
    kind = s.llm_backend
    if kind == "openai":
        if not s.openai_api_key:
            logger.warning("未配置 OPENAI_API_KEY，自动降级为 mock 后端")
            kind = "mock"
        else:
            try:
                _backend = OpenAIBackend()
                return _backend
            except Exception as e:
                logger.warning("OpenAI 后端初始化失败，降级 mock: %s", e)
                kind = "mock"
    if kind == "anthropic":
        try:
            _backend = AnthropicBackend()
            return _backend
        except Exception as e:
            logger.warning("Anthropic 后端初始化失败，降级 mock: %s", e)
    _backend = MockBackend()
    return _backend


def set_backend(backend: LLMBackend) -> None:
    global _backend
    _backend = backend


def reset_backend() -> None:
    global _backend
    _backend = None


# ---------------------------------------------------------------- 统一入口
def _log_call(payload: dict) -> None:
    try:
        p = PROJECT_ROOT / "logs" / "llm_calls.jsonl"
        p.parent.mkdir(exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _execute(
    messages: list[dict],
    tools: list[dict] | None,
    json_mode: bool,
    model: str | None,
    temperature: float | None,
    tag: str,
    max_retries: int,
    fallback: str,
) -> LLMResponse:
    s = get_settings()
    tracer = get_tracer()
    backend = get_backend()
    summary = " ".join(str(m.get("content", "")) for m in messages)[-200:]
    start = time.time()
    last_err: Exception | None = None

    for attempt in range(max_retries + 1):
        with tracer.trace("llm.call", tags=["llm", tag], model=model or s.model_name) as span:
            try:
                resp = backend.chat(messages, tools=tools, json_mode=json_mode,
                                    model=model, temperature=temperature)
            except Exception as e:  # 网络/限流等
                last_err = e
                span.meta["attempt"] = attempt
                span.set_output(f"error: {e}")
                if attempt < max_retries:
                    time.sleep(min(2 ** attempt, 8))
                continue
            span.tokens_in, span.tokens_out = resp.tokens_in, resp.tokens_out
            span.set_output((resp.content or f"tool_calls={len(resp.tool_calls)}")[:300])
            get_tracker().add(resp.model or s.model_name, resp.tokens_in, resp.tokens_out, tag=tag)
            _log_call({
                "ts": time.time(),
                "latency_ms": round((time.time() - start) * 1000, 1),
                "backend": resp.backend,
                "model": resp.model,
                "tag": tag,
                "prompt_summary": summary,
                "tokens_in": resp.tokens_in,
                "tokens_out": resp.tokens_out,
                "tool_calls": [tc.name for tc in resp.tool_calls],
            })
            return resp

    logger.error("LLM 调用最终失败（%s 次）: %s", max_retries + 1, last_err)
    return LLMResponse(content=fallback, model=model or s.model_name,
                       tokens_in=0, tokens_out=0, backend="fallback")


def call_llm(
    prompt: str,
    system: str = "",
    json_mode: bool = False,
    temperature: float | None = None,
    max_retries: int | None = None,
    model: str | None = None,
    tag: str = "llm",
    fallback: str = "",
) -> str:
    """统一 LLM 调用入口，支持指数退避重试。失败返回 fallback 而非崩溃。"""
    s = get_settings()
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    resp = _execute(
        messages, None, json_mode, model, temperature, tag,
        s.max_retries if max_retries is None else max_retries, fallback,
    )
    return resp.content


def call_llm_json(
    prompt: str,
    schema: dict | None = None,
    system: str = "",
    model: str | None = None,
    tag: str = "llm",
) -> dict | list:
    """JSON 模式调用，返回结构化数据；失败返回 {} / []。"""
    s = get_settings()
    model = model or s.cheap_model_name
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt + "\n只输出合法 JSON，不要其他内容。"})
    resp = _execute(messages, None, True, model, s.temperature, tag, s.max_retries, "")
    parsed = _extract_json(resp.content)
    return parsed if parsed is not None else {}


def call_llm_with_tools(
    messages: list[dict],
    tools: list[dict],
    model: str | None = None,
    temperature: float | None = None,
    tag: str = "decide",
) -> LLMResponse:
    """Function Calling 入口（角色 Agent 决策循环使用）。"""
    s = get_settings()
    return _execute(messages, tools, False, model or s.model_name, temperature,
                    tag, s.max_retries, "")
