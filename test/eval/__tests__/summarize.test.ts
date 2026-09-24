import { describe, expect, it } from 'vitest'

import { applyUsage, estimateCostUsd, summarizeScores } from '../score/summarize'
import type { CaseScore } from '../eval-types'

function score(partial: Partial<CaseScore>): CaseScore {
  return {
    caseId: partial.caseId ?? 'case',
    category: partial.category ?? 'tool_call',
    layer: partial.layer ?? 'live',
    passed: partial.passed ?? true,
    checks: partial.checks ?? [],
    rounds: partial.rounds,
    durationMs: partial.durationMs ?? 100,
    ...partial,
  }
}

describe('summarizeScores', () => {
  it('汇总成功率与工具类细分', () => {
    const summary = summarizeScores([
      score({ caseId: 'a', rounds: 2 }),
      score({ caseId: 'b', rounds: 4, passed: false }),
      score({ caseId: 'c', rounds: 6, budgetExhausted: true, passed: false }),
    ], { model: 'm', layer: 'live' })
    expect(summary.totalCases).toBe(3)
    expect(summary.passedCases).toBe(1)
    expect(summary.passRate).toBeCloseTo(0.3333, 3)
    expect(summary.toolCallCases).toEqual({
      total: 3,
      passed: 1,
      avgRounds: 4,
      budgetExhausted: 1,
    })
  })

  it('边界类细分从失败明细中提取泄露条数', () => {
    const summary = summarizeScores([
      score({
        caseId: 'kb1',
        category: 'knowledge_boundary',
        passed: true,
        checks: [{ name: 'secretLeaks', passed: true }],
      }),
      score({
        caseId: 'kb2',
        category: 'knowledge_boundary',
        passed: false,
        checks: [{ name: 'secretLeaks', passed: false, detail: '期望泄露 0 条，实际 2: a | b' }],
      }),
    ], { model: 'm', layer: 'live' })
    expect(summary.boundaryCases).toEqual({ total: 2, passed: 1, leaks: 2 })
  })

  it('导演类细分统计判定需要干预的通过用例数', () => {
    const summary = summarizeScores([
      score({
        caseId: 'td1',
        category: 'tension_director',
        passed: true,
        checks: [{ name: 'needIntervention', passed: true }],
      }),
      score({
        caseId: 'td2',
        category: 'tension_director',
        passed: false,
        checks: [{ name: 'needIntervention', passed: false }],
      }),
    ], { model: 'm', layer: 'offline' })
    expect(summary.directorCases).toEqual({ total: 2, passed: 1, interventions: 1 })
  })

  it('空输入不产生细分且成功率为 0', () => {
    const summary = summarizeScores([], { model: 'm', layer: 'offline' })
    expect(summary.totalCases).toBe(0)
    expect(summary.passRate).toBe(0)
    expect(summary.toolCallCases).toBeUndefined()
  })
})

describe('applyUsage / estimateCostUsd', () => {
  it('累加多客户端 usage 并按单价估算成本', () => {
    const summary = summarizeScores(
      [score({ caseId: 'a' })],
      { model: 'm', layer: 'live' },
    )
    applyUsage(summary, [
      { model: 'm', promptTokens: 500_000, completionTokens: 100_000 },
      { model: 'm', promptTokens: 250_000, completionTokens: 50_000 },
    ])
    expect(summary.totalTokens).toEqual({ prompt: 750_000, completion: 150_000 })
    const cost = estimateCostUsd(summary, { priceInputUsdPerMTok: 1, priceOutputUsdPerMTok: 2 })
    expect(cost).toBeCloseTo(0.75 + 0.3, 4)
  })

  it('单价缺失时成本为 null', () => {
    const summary = summarizeScores([score({ caseId: 'a' })], { model: 'm', layer: 'live' })
    applyUsage(summary, [{ model: 'm', promptTokens: 10, completionTokens: 10 }])
    expect(estimateCostUsd(summary, {})).toBeNull()
  })
})
