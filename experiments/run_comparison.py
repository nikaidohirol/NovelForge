"""三种干预策略对比实验入口。

用法：
    python experiments/run_comparison.py                # 使用 experiments/config.yaml
    python experiments/run_comparison.py --turns 20 --repeats 3

固定随机种子，输出 output/results.json / report.md / tension_curves.png。
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.metrics import aggregate, compute_metrics, judge_consistency  # noqa: E402
from experiments.report_generator import generate_report  # noqa: E402
from src.graph.workflow import run_batch  # noqa: E402
from src.models.character import CharacterCard  # noqa: E402
from src.observability.cost import get_tracker  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CHARACTERS_DIR = ROOT / "data" / "characters"
SCENARIOS_DIR = ROOT / "data" / "scenarios"


def load_cards(only: list[str] | None = None) -> dict[str, CharacterCard]:
    cards = {}
    for p in sorted(CHARACTERS_DIR.glob("*.json")):
        card = CharacterCard.model_validate_json(p.read_text(encoding="utf-8"))
        if not only or card.name in only:
            cards[card.name] = card
    return cards


def main() -> None:
    cfg_path = Path(__file__).parent / "config.yaml"
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))

    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", type=int, default=None)
    ap.add_argument("--repeats", type=int, default=None)
    args = ap.parse_args()

    turns = args.turns or cfg.get("turns", 12)
    repeats = args.repeats or cfg.get("repeats", 2)
    base_seed = cfg.get("base_seed", 42)
    strategies = cfg.get("strategies", ["threshold", "rate_based", "periodic"])
    judge_enabled = cfg.get("judge_enabled", True)

    scenario = (SCENARIOS_DIR / f"{cfg.get('scenario', 'cafe_meeting')}.json")
    scene = __import__("json").loads(scenario.read_text(encoding="utf-8"))
    cards = load_cards(cfg.get("characters") or None)

    print(f"实验设计：{len(strategies)} 策略 × {repeats} 次 × {turns} 轮，"
          f"角色 {list(cards)}，seed 基数 {base_seed}")

    runs: list[dict] = []
    for strategy in strategies:
        for repeat in range(repeats):
            seed = base_seed + repeat * 100 + hash(strategy) % 97
            random.seed(seed)
            print(f"--- 运行 {strategy} #{repeat} (seed={seed}) ---")
            batch = run_batch(list(cards.values()), scene,
                              max_turns=turns, strategy_name=strategy)
            tool_calls_before = 0
            metrics = compute_metrics(batch, tool_calls_before)
            run = {
                "strategy": strategy,
                "repeat": repeat,
                "seed": seed,
                "metrics": metrics,
                "tension_history": batch.get("tension_history", []),
            }
            if judge_enabled and batch.get("chapter"):
                run["judge_score"] = judge_consistency(batch["chapter"], cards)
            run["cost"] = get_tracker().summary(group_by="tag")["total_cost_usd"]
            runs.append(run)
            print(f"    turns={metrics['total_turns']} tension={metrics['tension_mean']} "
                  f"interventions={metrics['intervention_count']}")

    summary = aggregate(runs)
    report_path = generate_report(runs, summary)
    print(f"完成。报告：{report_path}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
