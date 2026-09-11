"""测试全局配置：mock 后端 / 本地 trace / naive 向量库 / hash embedding，零网络依赖。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("LLM_BACKEND", "mock")
os.environ.setdefault("TRACE_BACKEND", "local")
os.environ.setdefault("VECTOR_STORE", "naive")
os.environ.setdefault("EMBEDDING_BACKEND", "hash")
os.environ.setdefault("CHROMA_PERSIST_DIR", str(ROOT / ".tmp_test_chroma"))
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("OPENAI_API_KEY", "")
os.environ.setdefault("HUMAN_CONFIRM_INTERVENTION", "false")

import pytest  # noqa: E402

from src.observability.cost import reset_tracker  # noqa: E402
from src.observability.trace import reset_tracer  # noqa: E402
from src.utils.llm import get_backend, reset_backend  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_singletons(tmp_path, monkeypatch):
    """每个测试：隔离 chroma 目录 + 重置单例与 settings 缓存。"""
    from config.settings import get_settings

    monkeypatch.setenv("CHROMA_PERSIST_DIR", str(tmp_path / "chroma"))
    get_settings.cache_clear()
    reset_backend()
    reset_tracer()
    reset_tracker()
    yield
    reset_backend()
    reset_tracer()
    reset_tracker()
    get_settings.cache_clear()


@pytest.fixture
def mock_backend():
    backend = get_backend()
    backend.set_script([])
    return backend


@pytest.fixture
def two_cards():
    from src.models.character import CharacterCard

    alice = CharacterCard.model_validate_json(
        (ROOT / "data" / "characters" / "alice.json").read_text(encoding="utf-8"))
    bob = CharacterCard.model_validate_json(
        (ROOT / "data" / "characters" / "bob.json").read_text(encoding="utf-8"))
    return [alice, bob]
