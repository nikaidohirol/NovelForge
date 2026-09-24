# Agent 评测报告 — deepseek-ai/DeepSeek-V4-Flash

- 生成时间：2026-09-24T06:35:08.007Z
- 执行层：live

## 汇总

| 指标 | 值 |
| --- | --- |
| 用例总数 | 14 |
| 通过 | 14 |
| 通过率 | 100.0% |
| 工具调用 | 6/6，平均轮次 2，预算耗尽 0 |
| 知识边界 | 6/6，泄露 0 条 |
| 张力导演 | 2/2，判定干预 2 次 |
| Token | prompt 2304 + completion 1659 |
| 估算成本 | — |

## 跨运行对比

| 时间 | 模型 | 层 | 通过率 | 工具 | 边界泄露 | Token | 成本 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-24 06:29:07 | deepseek-ai/DeepSeek-V4-Flash | live | 85.7% | 5/6 | 0 | 3845 | — |
| 2026-09-24 06:35:08 | deepseek-ai/DeepSeek-V4-Flash | live | 100.0% | 6/6 | 0 | 3963 | — |

## 用例明细

| 用例 | 类别 | 结果 | 失败项 | 轮次 | 耗时 |
| --- | --- | --- | --- | --- | --- |
| tool-live-01 | tool_call | PASS | — | 2 | 5809ms |
| tool-live-02 | tool_call | PASS | — | 3 | 9483ms |
| tool-live-03 | tool_call | PASS | — | 1 | 3376ms |
| tool-live-04 | tool_call | PASS | — | 2 | 2899ms |
| tool-live-05 | tool_call | PASS | — | 2 | 5556ms |
| tool-live-06 | tool_call | PASS | — | 2 | 3112ms |
| kb-live-01 | knowledge_boundary | PASS | — | — | 3435ms |
| kb-live-02 | knowledge_boundary | PASS | — | — | 3250ms |
| kb-live-03 | knowledge_boundary | PASS | — | — | 2114ms |
| kb-live-04 | knowledge_boundary | PASS | — | — | 2911ms |
| kb-live-05 | knowledge_boundary | PASS | — | — | 2793ms |
| kb-live-06 | knowledge_boundary | PASS | — | — | 2608ms |
| tension-live-01 | tension_director | PASS | — | — | 4777ms |
| tension-live-02 | tension_director | PASS | — | — | 1089ms |

```nf-eval-summary
{
  "generatedAt": "2026-09-24T06:35:08.007Z",
  "model": "deepseek-ai/DeepSeek-V4-Flash",
  "layer": "live",
  "totalCases": 14,
  "passedCases": 14,
  "passRate": 1,
  "toolCallCases": {
    "total": 6,
    "passed": 6,
    "avgRounds": 2,
    "budgetExhausted": 0
  },
  "boundaryCases": {
    "total": 6,
    "passed": 6,
    "leaks": 0
  },
  "directorCases": {
    "total": 2,
    "passed": 2,
    "interventions": 2
  },
  "totalTokens": {
    "prompt": 2304,
    "completion": 1659
  },
  "estimatedCostUsd": null
}
```