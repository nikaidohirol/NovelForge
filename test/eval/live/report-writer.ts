/**
 * Agent 评测 — Markdown 报告生成
 *
 * 报告写入 eval-reports/（入库），原始 transcript 写入 eval-reports/transcripts/（不入库）。
 * 每份报告尾部嵌入 ```nf-eval-summary JSON 块，后续运行读取历史块渲染跨模型对比表。
 * 所有写盘文本先经 redactSecrets 脱敏，确保 API key 绝不落盘。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CaseScore, EvalSummary } from '../eval-types'
import type { EvalTranscript } from './live-runner'

export interface WriteReportOptions {
  summary: EvalSummary
  scores: CaseScore[]
  transcripts: EvalTranscript[]
  apiKey: string
  reportsDir?: string
  transcriptsDir?: string
}

/** 将敏感串替换为占位符（顺序替换，长串优先，防止短串破坏长串匹配） */
export function redactSecrets(text: string, secrets: string[]): string {
  let result = text
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]')
  }
  return result
}

function sanitizeModelName(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function fmtPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function fmtCost(cost: number | null | undefined): string {
  return cost === null || cost === undefined ? '—' : `$${cost.toFixed(4)}`
}

/** 从既有报告中提取历史汇总（nf-eval-summary 围栏块） */
export function loadHistorySummaries(reportsDir: string, excludeGeneratedAt: string): EvalSummary[] {
  if (!existsSync(reportsDir)) return []
  const history: EvalSummary[] = []
  for (const file of readdirSync(reportsDir)) {
    if (!file.endsWith('.md')) continue
    const content = readFileSync(resolve(reportsDir, file), 'utf8')
    const match = content.match(/```nf-eval-summary\s*([\s\S]*?)```/)
    if (!match) continue
    try {
      const parsed = JSON.parse(match[1]) as EvalSummary
      if (parsed.generatedAt !== excludeGeneratedAt) history.push(parsed)
    } catch {
      // 历史报告块损坏时跳过，不影响本次报告
    }
  }
  return history.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
}

function renderSummaryTable(summary: EvalSummary): string[] {
  const rows = [
    '| 指标 | 值 |',
    '| --- | --- |',
    `| 用例总数 | ${summary.totalCases} |`,
    `| 通过 | ${summary.passedCases} |`,
    `| 通过率 | ${fmtPercent(summary.passRate)} |`,
  ]
  if (summary.toolCallCases) {
    rows.push(
      `| 工具调用 | ${summary.toolCallCases.passed}/${summary.toolCallCases.total}，平均轮次 ${summary.toolCallCases.avgRounds}，预算耗尽 ${summary.toolCallCases.budgetExhausted} |`,
    )
  }
  if (summary.boundaryCases) {
    rows.push(
      `| 知识边界 | ${summary.boundaryCases.passed}/${summary.boundaryCases.total}，泄露 ${summary.boundaryCases.leaks} 条 |`,
    )
  }
  if (summary.directorCases) {
    rows.push(
      `| 张力导演 | ${summary.directorCases.passed}/${summary.directorCases.total}，判定干预 ${summary.directorCases.interventions} 次 |`,
    )
  }
  if (summary.totalTokens) {
    rows.push(
      `| Token | prompt ${summary.totalTokens.prompt} + completion ${summary.totalTokens.completion} |`,
      `| 估算成本 | ${fmtCost(summary.estimatedCostUsd)} |`,
    )
  }
  return rows
}

function renderComparisonTable(summary: EvalSummary, history: EvalSummary[]): string[] {
  const runs = [...history, summary]
  const rows = [
    '## 跨运行对比',
    '',
    '| 时间 | 模型 | 层 | 通过率 | 工具 | 边界泄露 | Token | 成本 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const run of runs) {
    const tool = run.toolCallCases ? `${run.toolCallCases.passed}/${run.toolCallCases.total}` : '—'
    const leaks = run.boundaryCases ? String(run.boundaryCases.leaks) : '—'
    const tokens = run.totalTokens
      ? `${run.totalTokens.prompt + run.totalTokens.completion}`
      : '—'
    rows.push(
      `| ${run.generatedAt.slice(0, 19).replace('T', ' ')} | ${run.model} | ${run.layer} | ${fmtPercent(run.passRate)} | ${tool} | ${leaks} | ${tokens} | ${fmtCost(run.estimatedCostUsd)} |`,
    )
  }
  return rows
}

function renderDetailTable(scores: CaseScore[]): string[] {
  const rows = [
    '## 用例明细',
    '',
    '| 用例 | 类别 | 结果 | 失败项 | 轮次 | 耗时 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const s of scores) {
    const failed = s.checks.filter(c => !c.passed)
      .map(c => `${c.name}${c.detail ? `（${c.detail}）` : ''}`)
      .join('; ')
    rows.push(
      `| ${s.caseId} | ${s.category} | ${s.passed ? 'PASS' : 'FAIL'} | ${failed || '—'} | ${s.rounds ?? '—'} | ${s.durationMs}ms |`,
    )
  }
  return rows
}

/** 写出报告与 transcript，返回报告文件路径 */
export async function writeEvalReport(opts: WriteReportOptions): Promise<string> {
  const reportsDir = opts.reportsDir ?? resolve(process.cwd(), 'eval-reports')
  const transcriptsDir = opts.transcriptsDir ?? resolve(reportsDir, 'transcripts')
  mkdirSync(reportsDir, { recursive: true })
  mkdirSync(transcriptsDir, { recursive: true })

  const { summary } = opts
  const redact = (text: string) => redactSecrets(text, [opts.apiKey])

  // transcript 落盘（不入库）
  for (const t of opts.transcripts) {
    const payload = redactSecrets(JSON.stringify(t, null, 2), [opts.apiKey])
    writeFileSync(resolve(transcriptsDir, `${t.caseId}.json`), payload, 'utf8')
  }

  const lines: string[] = [
    `# Agent 评测报告 — ${summary.model}`,
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- 执行层：${summary.layer}`,
    '',
    '## 汇总',
    '',
    ...renderSummaryTable(summary),
    '',
  ]
  const history = loadHistorySummaries(reportsDir, summary.generatedAt)
  if (history.length > 0) lines.push(...renderComparisonTable(summary, history), '')
  lines.push(...renderDetailTable(opts.scores), '')
  lines.push('```nf-eval-summary')
  lines.push(JSON.stringify(summary, null, 2))
  lines.push('```')

  const fileName = `${summary.generatedAt.slice(0, 10)}-${sanitizeModelName(summary.model)}.md`
  const reportPath = resolve(reportsDir, fileName)
  writeFileSync(reportPath, redact(lines.join('\n')), 'utf8')
  return reportPath
}
