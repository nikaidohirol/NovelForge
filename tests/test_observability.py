"""可观测性测试（聚焦点 D）：span 嵌套 / jsonl 落盘 / 成本核算。"""
from __future__ import annotations

import json

from config.settings import PROJECT_ROOT
from src.observability.cost import get_tracker
from src.observability.trace import get_tracer


def test_span_nesting_hierarchy():
    tracer = get_tracer()
    with tracer.trace("turn.1", tags=["turn"]) as turn_span:
        with tracer.trace("agent.A.decide", tags=["agent"]) as agent_span:
            with tracer.trace("llm.call", tags=["llm"]) as llm_span:
                pass
    assert llm_span.parent_id == agent_span.id
    assert agent_span.parent_id == turn_span.id
    assert turn_span.parent_id is None


def test_spans_persisted_to_jsonl():
    tracer = get_tracer()
    with tracer.trace("turn.9", tags=["turn"]) as span:
        span.set_output("hello")
    spans = tracer.read_all()
    assert any(s["name"] == "turn.9" and s["output"] == "hello" for s in spans)


def test_span_latency_recorded():
    tracer = get_tracer()
    import time

    with tracer.trace("timed") as span:
        time.sleep(0.01)
    assert span.latency_ms >= 5


def test_cost_grouped_by_tag():
    tracker = get_tracker()
    tracker.add("gpt-4o", 1000, 500, tag="decide")
    tracker.add("gpt-4o", 1000, 500, tag="decide")
    tracker.add("gpt-4o-mini", 200, 100, tag="importance")
    summary = tracker.summary(group_by="tag")
    assert summary["items"]["decide"]["calls"] == 2
    assert summary["items"]["importance"]["calls"] == 1
    assert summary["total_cost_usd"] > 0
    by_model = tracker.summary(group_by="model")
    assert by_model["items"]["gpt-4o-mini"]["tokens_in"] == 200


def test_llm_calls_logged(monkeypatch):
    """mock 后端调用 → llm_calls.jsonl 有记录且带 tag。"""
    from src.utils.llm import call_llm_json

    call_llm_json("随便点什么", tag="importance")
    p = PROJECT_ROOT / "logs" / "llm_calls.jsonl"
    assert p.exists()
    rows = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines()]
    assert rows[-1]["tag"] == "importance"
