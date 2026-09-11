"""★ 聚焦点 D：成本核算。按 (model, tag) 记录 token 与估算成本，进实验报告。"""
from __future__ import annotations

import threading
from collections import defaultdict

from config.settings import get_settings


class UsageTracker:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._lock = threading.Lock()
        self._by_model: dict[str, dict[str, float]] = defaultdict(
            lambda: {"tokens_in": 0, "tokens_out": 0, "calls": 0, "cost_usd": 0.0}
        )
        self._by_tag: dict[str, dict[str, float]] = defaultdict(
            lambda: {"tokens_in": 0, "tokens_out": 0, "calls": 0, "cost_usd": 0.0}
        )

    def add(self, model: str, tokens_in: int, tokens_out: int, tag: str = "llm") -> None:
        pin, pout = self.settings.price_of(model)
        cost = (tokens_in * pin + tokens_out * pout) / 1_000_000
        with self._lock:
            for bucket, key in ((self._by_model, model), (self._by_tag, tag)):
                b = bucket[key]
                b["tokens_in"] += tokens_in
                b["tokens_out"] += tokens_out
                b["calls"] += 1
                b["cost_usd"] = round(b["cost_usd"] + cost, 6)

    def summary(self, group_by: str = "tag") -> dict:
        with self._lock:
            src = self._by_tag if group_by == "tag" else self._by_model
            data = {k: dict(v) for k, v in src.items()}
        total_cost = sum(v["cost_usd"] for v in data.values())
        return {"items": data, "total_cost_usd": round(total_cost, 6)}

    def reset(self) -> None:
        with self._lock:
            self._by_model.clear()
            self._by_tag.clear()


_tracker: UsageTracker | None = None


def get_tracker() -> UsageTracker:
    global _tracker
    if _tracker is None:
        _tracker = UsageTracker()
    return _tracker


def reset_tracker() -> None:
    global _tracker
    _tracker = None
