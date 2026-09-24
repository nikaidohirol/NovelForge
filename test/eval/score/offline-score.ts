/**
 * Agent 评测 — 离线规则评分器
 *
 * 全部为纯函数：输入模型输出（或预设输出）与解析结果，输出逐项断言结果。
 * 评分只做规则判断（子串包含、区间阈值、精确匹配），不调用 LLM。
 * 工具注册等执行副作用由 runner 负责，不在评分器内发生。
 */

import {
  normalizeDirectorInsight,
  scanSecretViolations,
} from '../../../src/shared/simulation-protocol'
import type {
  EvalCase,
  EvalCheck,
} from '../eval-types'

/** 文本归一化：去空白、统一全半角标点，降低中文输出断言的敏感性 */
export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/，/g, ',')
    .replace(/。/g, '.')
    .replace(/：/g, ':')
    .replace(/；/g, ';')
    .replace(/「|」|『|』|“|”|‘|’/g, '')
    .toLowerCase()
}

function argEqual(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  try {
    return JSON.stringify(actual) === JSON.stringify(expected)
  } catch {
    return false
  }
}

/** parseToolCalls 的返回结构（与 agent-engine 导出一致） */
export interface ParsedToolCallOutput {
  textParts: string[]
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
}

/** 比对工具调用列表（exact=精确序列，subset=按序消耗的包含匹配） */
function matchToolCalls(
  actual: Array<{ name: string; arguments: Record<string, unknown> }>,
  expected: NonNullable<EvalCase['expect']>['toolCalls'],
  matchMode: 'exact' | 'subset',
): EvalCheck {
  const name = 'toolCalls'
  if (!expected) return { name, passed: true }
  if (matchMode === 'exact') {
    const passed = actual.length === expected.length
      && expected.every((exp, i) => {
        const act = actual[i]
        return act && act.name === exp.name && argEqual(act.arguments, exp.arguments)
      })
    return {
      name,
      passed,
      detail: passed ? undefined : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
    }
  }
  // subset：期望的每次调用都出现在实际列表里（按顺序消耗，允许额外调用）
  const pool = [...actual]
  const missing = expected.filter(exp => {
    const idx = pool.findIndex(act => act.name === exp.name && argEqual(act.arguments, exp.arguments))
    if (idx >= 0) {
      pool.splice(idx, 1)
      return false
    }
    return true
  })
  return {
    name,
    passed: missing.length === 0,
    detail: missing.length === 0 ? undefined : `缺少调用: ${missing.map(m => m.name).join(', ')}`,
  }
}

/** 解析容错评分：比对解析出的调用与 textParts */
export function scoreParseTolerance(
  parsed: ParsedToolCallOutput,
  expected: EvalCase['expect'],
): EvalCheck[] {
  const checks: EvalCheck[] = []
  if (expected.toolCalls) {
    checks.push(matchToolCalls(parsed.toolCalls, expected.toolCalls, expected.matchMode ?? 'exact'))
  }
  if (expected.textParts) {
    const passed = expected.textParts.length === parsed.textParts.length
      && expected.textParts.every((part, i) => part === parsed.textParts[i])
    checks.push({
      name: 'textParts',
      passed,
      detail: passed ? undefined : `期望 ${JSON.stringify(expected.textParts)}，实际 ${JSON.stringify(parsed.textParts)}`,
    })
  }
  return checks
}

/** 知识边界评分：发言经 scanSecretViolations 扫描，泄露数须等于期望 */
export function scoreKnowledgeBoundary(
  utterance: string,
  others: Array<{ name: string; secrets: readonly string[] }>,
  expected: EvalCase['expect'],
): EvalCheck[] {
  const violations = scanSecretViolations(utterance, others)
  const expectedLeaks = expected.secretLeaks ?? 0
  const checks: EvalCheck[] = [
    {
      name: 'secretLeaks',
      passed: violations.length === expectedLeaks,
      detail: violations.length === expectedLeaks
        ? undefined
        : `期望泄露 ${expectedLeaks} 条，实际 ${violations.length}: ${violations.join(' | ')}`,
    },
    {
      name: 'responded',
      passed: utterance.trim().length > 0,
      detail: utterance.trim().length > 0 ? undefined : '发言为空',
    },
  ]
  if (expected.textContains) {
    const normalized = normalizeText(utterance)
    for (const needle of expected.textContains) {
      checks.push({
        name: `textContains:${needle}`,
        passed: normalized.includes(normalizeText(needle)),
      })
    }
  }
  return checks
}

/** 从导演输出中提取首个 JSON 对象（容错：剥离围栏与散文） */
export function extractDirectorJson(output: string): unknown | undefined {
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : output
  const start = candidate.indexOf('{')
  if (start < 0) return undefined
  const end = candidate.lastIndexOf('}')
  if (end <= start) return undefined
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** 张力导演评分：提取 JSON → 归一化 → 张力区间与干预判定 */
export function scoreTensionDirector(
  output: string,
  expected: EvalCase['expect'],
): EvalCheck[] {
  const raw = extractDirectorJson(output)
  const checks: EvalCheck[] = []
  if (raw === undefined) {
    return [{ name: 'directorJson', passed: false, detail: '输出中未找到可解析的 JSON 对象' }]
  }
  const insight = normalizeDirectorInsight(raw)
  if (expected.tension) {
    const { min, max } = expected.tension
    checks.push({
      name: 'tension',
      passed: insight.tension >= min && insight.tension <= max,
      detail: `张力 ${insight.tension} 不在 [${min}, ${max}]`,
    })
  }
  if (expected.needIntervention !== undefined) {
    checks.push({
      name: 'needIntervention',
      passed: insight.needIntervention === expected.needIntervention,
      detail: `期望 ${expected.needIntervention}，实际 ${insight.needIntervention}`,
    })
  }
  if (expected.eventType) {
    checks.push({
      name: 'eventType',
      passed: insight.eventType === expected.eventType,
      detail: `期望 ${expected.eventType}，实际 ${insight.eventType ?? '（无）'}`,
    })
  }
  return checks
}

/** 工具调用类评分：对 live 运行产物做规则断言 */
export function scoreToolCallRun(
  result: {
    finalText: string
    toolCalls: Array<{ toolName: string; status: string; arguments: Record<string, unknown> }>
    rounds: number
    error?: string
    budgetExhausted?: boolean
    confirmationIntercepted?: boolean
  },
  expected: EvalCase['expect'],
): EvalCheck[] {
  const checks: EvalCheck[] = []
  if (result.error) {
    checks.push({ name: 'noError', passed: false, detail: result.error })
    return checks
  }
  checks.push({ name: 'noError', passed: true })

  const requireToolCall = expected.requireToolCall ?? (expected.toolCalls !== undefined)
  if (requireToolCall) {
    const anyCall = result.toolCalls.length > 0
      && result.toolCalls.every(t => t.status === 'completed')
    checks.push({
      name: 'toolExecuted',
      passed: anyCall,
      detail: anyCall ? undefined : `工具调用列表: ${JSON.stringify(result.toolCalls.map(t => ({ name: t.toolName, status: t.status })))}`,
    })
  } else {
    checks.push({
      name: 'noToolCall',
      passed: result.toolCalls.length === 0,
      detail: result.toolCalls.length === 0 ? undefined : `意外调用: ${result.toolCalls.map(t => t.toolName).join(', ')}`,
    })
  }

  if (expected.toolCalls) {
    checks.push(matchToolCalls(
      result.toolCalls.map(t => ({ name: t.toolName, arguments: t.arguments })),
      expected.toolCalls,
      expected.matchMode ?? 'subset',
    ))
  }

  if (expected.maxRounds !== undefined) {
    checks.push({
      name: 'maxRounds',
      passed: result.rounds <= expected.maxRounds && !result.budgetExhausted,
      detail: `轮次 ${result.rounds}（上限 ${expected.maxRounds}）${result.budgetExhausted ? '，预算耗尽' : ''}`,
    })
  }

  if (expected.textContains) {
    const normalized = normalizeText(result.finalText)
    for (const needle of expected.textContains) {
      checks.push({
        name: `textContains:${needle}`,
        passed: normalized.includes(normalizeText(needle)),
        detail: normalized.includes(normalizeText(needle)) ? undefined : `回答未包含「${needle}」`,
      })
    }
  }
  return checks
}
