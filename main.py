"""NovelForge CLI 入口（批量路径：LangGraph 编排 + checkpointer）。

用法：
    python main.py \
      --characters data/characters/alice.json data/characters/bob.json \
      --scenario data/scenarios/cafe_meeting.json \
      --max-turns 20 \
      --strategy rate_based \
      --output output/chapter1.md
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from rich.console import Console  # noqa: E402

from config.settings import get_settings  # noqa: E402
from src.graph.workflow import run_batch  # noqa: E402
from src.models.character import CharacterCard  # noqa: E402
from src.observability.cost import get_tracker  # noqa: E402
from src.observability.trace import get_tracer  # noqa: E402

console = Console()


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="NovelForge — 多 Agent 轻小说生成")
    ap.add_argument("--characters", nargs="+", required=True, help="角色卡 JSON 路径")
    ap.add_argument("--scenario", required=True, help="场景 JSON 路径")
    ap.add_argument("--max-turns", type=int, default=None)
    ap.add_argument("--strategy", default=None,
                    choices=["threshold", "rate_based", "periodic"])
    ap.add_argument("--backend", default=None, choices=["openai", "anthropic", "mock"],
                    help="覆盖 LLM 后端（默认读 .env）")
    ap.add_argument("--trace-backend", default=None, choices=["local", "langfuse"])
    ap.add_argument("--output", default="output/chapter.md")
    return ap.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()
    if args.backend:
        settings.llm_backend = args.backend
    if args.trace_backend:
        settings.trace_backend = args.trace_backend

    cards = [CharacterCard.model_validate_json(Path(p).read_text(encoding="utf-8"))
             for p in args.characters]
    scene = json.loads(Path(args.scenario).read_text(encoding="utf-8"))

    console.print(f"[bold]NovelForge[/] 启动：{len(cards)} 角色 · 策略 "
                  f"{args.strategy or settings.intervention_strategy} · "
                  f"后端 {settings.llm_backend}")

    result = run_batch(cards, scene, max_turns=args.max_turns,
                       strategy_name=args.strategy)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    chapter = result.get("chapter") or {}
    content = f"# {chapter.get('title', '未命名章节')}\n\n{chapter.get('content', '')}"
    out.write_text(content, encoding="utf-8")

    console.print(f"回合数：{result.get('total_turns')} · 干预：{len(result.get('interventions', []))}")
    console.print(f"成本：${get_tracker().summary()['total_cost_usd']:.4f}")
    console.print(f"章节已写入：{out.resolve()}")
    console.print(f"Trace：logs/traces.jsonl（{len(get_tracer().read_all(10**9))} spans）")
    get_tracer().flush()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
