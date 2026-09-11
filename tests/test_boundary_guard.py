"""知识边界守卫测试（聚焦点 B）：直接匹配 / 语义匹配 / 拦截重生成 / 强制降级。"""
from __future__ import annotations

import json

from src.boundary.boundary_guard import BoundaryGuard
from src.models.character import CharacterCard
from src.utils.llm import get_backend

CARD = CharacterCard.model_validate({
    "spec": "chara_card_v2", "spec_version": "2.0",
    "data": {"name": "艾莉丝", "description": "d", "personality": "谨慎"},
    "unknown_facts": ["地下组织的首领是谁", "哥哥是否还活着"],
})


def _script(extract, regenerate=None):
    """构造脚本化 mock：声明抽取响应（dict 自动包装为数组），可选重生成交互。"""
    backend = get_backend()
    first = [extract] if isinstance(extract, dict) and "subject" in extract else extract
    script = [first]
    if regenerate is not None:
        script.append([regenerate] if isinstance(regenerate, dict) and "subject" in regenerate
                      else regenerate)
    backend.set_script(script)
    return backend


def test_clean_utterance_passes():
    _script([])  # 无声明
    guard = BoundaryGuard()
    action, violations = guard.check(
        {"action_type": "speak", "content": "今天的雨真大。"}, CARD, turn=1)
    assert violations == []


def test_direct_match_intercepted():
    # 声明「地下组织 首领 伊芙」直接命中 unknown_facts
    _script([{"subject": "地下组织", "relation": "首领", "object": "伊芙"}])
    guard = BoundaryGuard()
    action, violations = guard.check(
        {"action_type": "speak", "content": "我听说地下组织的首领就是伊芙。"}, CARD, turn=1)
    assert len(violations) == 1
    assert violations[0].violation_type == "direct_match"


def test_semantic_match_without_direct_hit():
    """词序改写 → 直接匹配不命中，但词法高度重叠 → 语义匹配（阈值放宽以便确定性测试）。"""
    card = CharacterCard.model_validate({
        "spec": "chara_card_v2", "spec_version": "2.0",
        "data": {"name": "艾莉丝", "description": "d", "personality": "谨慎"},
        "unknown_facts": ["地下组织的首领藏身于镇上的旧仓库"],
    })
    _script([{"subject": "镇上的旧仓库里", "relation": "藏着", "object": "地下组织的首领"}])
    guard = BoundaryGuard(semantic_threshold=0.5)
    _, violations = guard.check(
        {"action_type": "speak", "content": "听说镇上的旧仓库里藏着地下组织的首领。"},
        card, turn=1)
    assert len(violations) == 1
    assert violations[0].violation_type == "semantic_match"

    # 无关声明不触发
    _script([{"subject": "天气", "relation": "变得", "object": "糟糕"}])
    _, violations = guard.check(
        {"action_type": "speak", "content": "天气变得真糟糕。"}, card, turn=2)
    assert violations == []


def test_enforce_regenerates_then_passes():
    backend = get_backend()
    # 第一次 check 抽出违规声明 → 重生成返回新内容 → 第二次 check 无声明 → 通过
    backend.set_script([
        {"subject": "地下组织", "relation": "首领", "object": "伊芙"},
        [],  # 重生成后的发言无违规声明
    ])
    guard = BoundaryGuard(max_retry=2)
    action = guard.enforce(
        {"action_type": "speak", "content": "地下组织的首领就是伊芙。"}, CARD, turn=1)
    assert action["action_type"] == "speak"
    assert action["content"]  # 已被重写


def test_enforce_forces_silence_after_retries():
    backend = get_backend()
    # 每次抽取都违规 → 重试耗尽 → 强制 silence
    backend.set_script([
        {"subject": "地下组织", "relation": "首领", "object": "伊芙"},
        {"subject": "地下组织", "relation": "首领", "object": "伊芙"},
        {"subject": "地下组织", "relation": "首领", "object": "伊芙"},
    ])
    guard = BoundaryGuard(max_retry=1)
    action = guard.enforce(
        {"action_type": "speak", "content": "地下组织的首领就是伊芙。"}, CARD, turn=1)
    assert action["action_type"] == "silence"


def test_violations_persisted_to_jsonl(tmp_path, monkeypatch):
    import src.boundary.boundary_guard as bg

    monkeypatch.setattr(bg, "PROJECT_ROOT", tmp_path)
    _script([{"subject": "地下组织", "relation": "首领", "object": "伊芙"}])
    guard = BoundaryGuard()
    guard.check({"action_type": "speak", "content": "x"}, CARD, turn=3)
    p = tmp_path / "logs" / "violations.jsonl"
    assert p.exists()
    rows = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines()]
    assert rows and rows[0]["violation_type"] == "direct_match"
