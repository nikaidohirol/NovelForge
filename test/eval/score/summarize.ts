/**
 * Agent 评测 — 汇总统计
 *
 * 将逐 case 评分聚合为 EvalSummary：成功率、分类细分、token 与成本。
 */

import type { CaseScore, EvalSummary, UsageRecord } from '../eval-types'

export interface RunMeta {
  model: string
  layer: 'offline' | 'live'
  /** 每百万 token 单价（美元），未提供则成本为 null */
  priceInputUsdPerMTok?: number
  priceOutputUsdPerMTok?: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** 聚合逐 case 评分为运行汇总 */
export function summarizeScores(scores: CaseScore[], meta: RunMeta): EvalSummary {
  const totalCases = scores.length
  const passedCases = scores.filter(s => s.passed).length
  const summary: EvalSummary = {
    generatedAt: new Date().toISOString(),
    model: meta.model,
    layer: meta.layer,
    totalCases,
    passedCases,
    passRate: totalCases === 0 ? 0 : round4(passedCases / totalCases),
  }

  const toolScores = scores.filter(s => s.category === 'tool_call')
  if (toolScores.length > 0) {
    summary.toolCallCases = {
      total: toolScores.length,
      passed: toolScores.filter(s => s.passed).length,
      avgRounds: round2(
        toolScores.reduce((acc, s) => acc + (s.rounds ?? 0), 0) / toolScores.length,
      ),
      budgetExhausted: toolScores.filter(s => s.budgetExhausted).length,
    }
  }

  const boundaryScores = scores.filter(s => s.category === 'knowledge_boundary')
  if (boundaryScores.length > 0) {
    summary.boundaryCases = {
      total: boundaryScores.length,
      passed: boundaryScores.filter(s => s.passed).length,
      leaks: boundaryScores.reduce((acc, s) => {
        const leakCheck = s.checks.find(c => c.name === 'secretLeaks' && !c.passed)
        if (!leakCheck) return acc
        // 从 detail 提取实际泄露数（「实际 N」）
        const match = /实际 (\d+)/.exec(leakCheck.detail ?? '')
        return acc + (match ? Number(match[1]) : 1)
      }, 0),
    }
  }

  const directorScores = scores.filter(s => s.category === 'tension_director')
  if (directorScores.length > 0) {
    summary.directorCases = {
      total: directorScores.length,
      passed: directorScores.filter(s => s.passed).length,
      interventions: directorScores.filter(s =>
        s.checks.some(c => c.name === 'needIntervention' && c.passed),
      ).length,
    }
  }

  if (meta.layer === 'live') {
    summary.totalTokens = { prompt: 0, completion: 0 }
  }
  return summary
}

/** 累加 live 客户端收集的 usage 记录到汇总（就地修改） */
export function applyUsage(summary: EvalSummary, usage: UsageRecord[]): void {
  if (!summary.totalTokens) summary.totalTokens = { prompt: 0, completion: 0 }
  for (const u of usage) {
    summary.totalTokens.prompt += u.promptTokens
    summary.totalTokens.completion += u.completionTokens
  }
}

/** 估算成本（美元）；单价未配置时返回 null */
export function estimateCostUsd(
  summary: EvalSummary,
  meta: Pick<RunMeta, 'priceInputUsdPerMTok' | 'priceOutputUsdPerMTok'>,
): number | null {
  if (!summary.totalTokens) return null
  const { priceInputUsdPerMTok, priceOutputUsdPerMTok } = meta
  if (priceInputUsdPerMTok === undefined || priceOutputUsdPerMTok === undefined) return null
  const cost = (summary.totalTokens.prompt / 1_000_000) * priceInputUsdPerMTok
    + (summary.totalTokens.completion / 1_000_000) * priceOutputUsdPerMTok
  return round4(cost)
}
