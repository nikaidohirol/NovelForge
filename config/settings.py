"""全局配置（pydantic-settings）。所有可调参数集中在此，环境变量 / .env 覆盖默认值。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根目录（config/ 的上一级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- LLM ----
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    anthropic_api_key: str = ""
    # openai | anthropic | mock
    llm_backend: str = "openai"
    model_name: str = "gpt-4o"
    # 便宜模型档：声明抽取 / importance 打分 / judge 等辅助任务使用
    cheap_model_name: str = "gpt-4o-mini"
    temperature: float = 0.8
    max_turns: int = 30
    max_retries: int = 3

    # ---- 导演干预（聚焦点 A） ----
    intervention_strategy: str = "rate_based"
    tension_threshold: float = 3.0
    rate_threshold: float = 0.05
    periodic_interval: int = 8
    low_tension_turns: int = 3
    human_confirm_intervention: bool = False

    # ---- 知识边界（聚焦点 B） ----
    boundary_semantic_threshold: float = 0.85
    boundary_max_retry: int = 2

    # ---- 工具调用（聚焦点 C） ----
    tool_max_calls_per_turn: int = 3

    # ---- 记忆 ----
    memory_max_entries: int = 200
    memory_prune_ratio: float = 0.2
    chroma_persist_dir: str = "./chroma_db"
    # auto | chroma | naive（naive 为纯 Python 余弦检索，测试/降级用）
    vector_store: str = "auto"
    # auto | openai | hash
    embedding_backend: str = "auto"

    # ---- 可观测性（聚焦点 D） ----
    # auto | local | langfuse
    trace_backend: str = "auto"
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"
    langgraph_checkpoint_dir: str = "./checkpoints"

    # ---- 日志 ----
    log_level: str = "INFO"

    # ---- 成本单价表（美元 / 百万 token） ----
    model_prices: dict[str, dict[str, float]] = {
        "gpt-4o": {"in": 2.5, "out": 10.0},
        "gpt-4o-mini": {"in": 0.15, "out": 0.6},
        "mock": {"in": 0.0, "out": 0.0},
    }

    def price_of(self, model: str) -> tuple[float, float]:
        p = self.model_prices.get(model, {"in": 0.0, "out": 0.0})
        return p.get("in", 0.0), p.get("out", 0.0)

    def ensure_dirs(self) -> None:
        (PROJECT_ROOT / "logs").mkdir(exist_ok=True)
        Path(self.chroma_persist_dir).mkdir(parents=True, exist_ok=True)
        Path(self.langgraph_checkpoint_dir).mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s
