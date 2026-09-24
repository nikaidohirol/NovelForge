/**
 * Agent 评测 — 离线执行器
 *
 * 处理 layer=offline 的用例：解析容错（注册桩工具后直调 parseToolCalls）
 * 与张力导演合成输出（纯归一化评分）。不发起任何网络请求。
 */

import { parseToolCalls } from '../../../src/services/agent/agent-engine'
import type { CaseScore, EvalCase, EvalCheck } from '../eval-types'
import { scoreParseTolerance, scoreTensionDirector } from '../score/offline-score'
import { registerEvalTools } from './agent-case-runner'

function toScore(evalCase: EvalCase, checks: EvalCheck[], startedAt: number): CaseScore {
  return {
    caseId: evalCase.id,
    category: evalCase.category,
    layer: evalCase.layer,
    passed: checks.length > 0 && checks.every(c => c.passed),
    checks,
    durationMs: Date.now() - startedAt,
  }
}

/** 执行单个离线用例并评分 */
export function runOfflineCase(evalCase: EvalCase): CaseScore {
  const startedAt = Date.now()
  if (evalCase.layer !== 'offline') {
    throw new Error(`[${evalCase.id}] runOfflineCase 只接受 offline 用例`)
  }
  if (evalCase.offlineOutput === undefined) {
    return toScore(evalCase, [{
      name: 'offlineOutput',
      passed: false,
      detail: '离线用例缺少预设输出',
    }], startedAt)
  }

  if (evalCase.category === 'parse_tolerance') {
    const cleanup = registerEvalTools(evalCase.tools ?? [])
    try {
      const parsed = parseToolCalls(evalCase.offlineOutput)
      return toScore(evalCase, scoreParseTolerance(parsed, evalCase.expect), startedAt)
    } finally {
      cleanup()
    }
  }

  if (evalCase.category === 'tension_director') {
    return toScore(evalCase, scoreTensionDirector(evalCase.offlineOutput, evalCase.expect), startedAt)
  }

  return toScore(evalCase, [{
    name: 'category',
    passed: false,
    detail: `离线执行器不支持类别: ${evalCase.category}`,
  }], startedAt)
}

/** 执行全部离线用例（保持用例顺序） */
export function runOfflineSuite(cases: EvalCase[]): CaseScore[] {
  return cases.filter(c => c.layer === 'offline').map(runOfflineCase)
}
