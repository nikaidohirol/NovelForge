"""结构化日志：Rich 控制台输出 + 可选文件输出。"""
from __future__ import annotations

import logging
from pathlib import Path

from config.settings import PROJECT_ROOT, get_settings

_configured = False


def _configure() -> None:
    global _configured
    if _configured:
        return
    level = getattr(logging, get_settings().log_level.upper(), logging.INFO)
    root = logging.getLogger("novelforge")
    root.setLevel(level)
    root.handlers.clear()
    try:
        from rich.logging import RichHandler

        root.addHandler(RichHandler(rich_tracebacks=True, markup=True, show_path=False))
    except ImportError:  # pragma: no cover
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
        root.addHandler(h)
    # 文件 handler
    logs_dir = PROJECT_ROOT / "logs"
    logs_dir.mkdir(exist_ok=True)
    fh = logging.FileHandler(logs_dir / "novelforge.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    fh.setLevel(level)
    root.addHandler(fh)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    _configure()
    if not name.startswith("novelforge"):
        name = f"novelforge.{name}"
    return logging.getLogger(name)
