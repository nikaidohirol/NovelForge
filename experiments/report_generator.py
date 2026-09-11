"""实验报告生成：results.json + report.md + tension_curves.png（matplotlib 可选）。"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

from config.settings import PROJECT_ROOT


def generate_report(runs: list[dict], summary: dict) -> Path:
    out_dir = PROJECT_ROOT / "output"
    out_dir.mkdir(exist_ok=True)

    (out_dir / "results.json").write_text(
        json.dumps({"runs": runs, "summary": summary}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines = ["# NovelForge 干预策略对比实验报告", ""]
    lines.append("| 策略 | 涌现事件率 | 张力均值 | 张力方差 | 干预次数 | 工具调用率 |")
    lines.append("|---|---|---|---|---|---|")
    for strategy, agg in summary.items():
        lines.append(
            f"| {strategy} "
            f"| {agg.get('emergence_rate', {}).get('mean', '-')} "
            f"| {agg.get('tension_mean', {}).get('mean', '-')} "
            f"| {agg.get('tension_var', {}).get('mean', '-')} "
            f"| {agg.get('intervention_count', {}).get('mean', '-')} "
            f"| {agg.get('tool_call_rate', {}).get('mean', '-')} |"
        )
    lines.append("")
    lines.append("## 各次运行明细")
    for run in runs:
        lines.append(
            f"- {run['strategy']} #{run['repeat']}: "
            f"turns={run['metrics']['total_turns']}, "
            f"tension={run['metrics']['tension_mean']}, "
            f"interventions={run['metrics']['intervention_count']}, "
            f"tool_calls={run['metrics']['tool_call_count']}, "
            f"judge={run.get('judge_score', '-')}"
        )
    report_path = out_dir / "report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")

    _plot_curves(runs, out_dir)
    return report_path


def _plot_curves(runs: list[dict], out_dir: Path) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "sans-serif"]
        fig, ax = plt.subplots(figsize=(10, 5))
        for run in runs:
            ax.plot(run.get("tension_history", []),
                    label=f"{run['strategy']}#{run['repeat']}", alpha=0.7)
        ax.set_xlabel("回合")
        ax.set_ylabel("张力")
        ax.set_title("三种干预策略张力曲线对比")
        ax.legend(fontsize=8)
        fig.tight_layout()
        fig.savefig(out_dir / "tension_curves.png", dpi=120)
        plt.close(fig)
    except Exception as e:  # matplotlib 缺失/中文字体问题不阻塞报告
        (out_dir / "tension_curves.png.skip").write_text(str(e), encoding="utf-8")
