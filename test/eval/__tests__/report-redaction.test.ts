import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadHistorySummaries, redactSecrets, writeEvalReport } from '../live/report-writer'
import type { CaseScore, EvalSummary } from '../eval-types'

const API_KEY = 'sk-secret-eval-key-123'

function makeSummary(generatedAt: string): EvalSummary {
  return {
    generatedAt,
    model: 'eval-model',
    layer: 'live',
    totalCases: 2,
    passedCases: 1,
    passRate: 0.5,
    totalTokens: { prompt: 100, completion: 50 },
    estimatedCostUsd: 0.01,
  }
}

function makeScores(): CaseScore[] {
  return [
    {
      caseId: 'tool-live-01',
      category: 'tool_call',
      layer: 'live',
      passed: true,
      checks: [{ name: 'noError', passed: true }],
      rounds: 2,
      durationMs: 1200,
    },
    {
      caseId: 'kb-live-01',
      category: 'knowledge_boundary',
      layer: 'live',
      passed: false,
      checks: [{ name: 'secretLeaks', passed: false, detail: '实际 1: 绫音' }],
      durationMs: 800,
    },
  ]
}

let dir: string
afterEach(() => {
  dir = ''
})

function newDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'nf-eval-report-'))
  return dir
}

describe('redactSecrets', () => {
  it('替换敏感串为占位符', () => {
    expect(redactSecrets('key is sk-secret-eval-key-123 ok', [API_KEY]))
      .toBe('key is [REDACTED] ok')
  })

  it('长串优先替换，避免短串破坏长串匹配', () => {
    expect(redactSecrets('abc-long-secret-xyz', ['long-secret', 'long'])).toBe('abc-[REDACTED]-xyz')
  })
})

describe('writeEvalReport', () => {
  it('报告与 transcript 落盘且不含 API key', async () => {
    const root = newDir()
    const summary = makeSummary('2026-09-24T03:00:00.000Z')
    const reportPath = await writeEvalReport({
      summary,
      scores: makeScores(),
      transcripts: [{
        caseId: 'tool-live-01',
        category: 'tool_call',
        model: 'eval-model',
        startedAt: summary.generatedAt,
        durationMs: 1200,
        output: '回答里误含了 sk-secret-eval-key-123',
        checks: [{ name: 'noError', passed: true }],
        passed: true,
      }],
      apiKey: API_KEY,
      reportsDir: join(root, 'eval-reports'),
    })

    expect(existsSync(reportPath)).toBe(true)
    const report = readFileSync(reportPath, 'utf8')
    expect(report).not.toContain(API_KEY)
    expect(report).toContain('Agent 评测报告 — eval-model')
    expect(report).toContain('tool-live-01')
    expect(report).toContain('```nf-eval-summary')

    const transcriptPath = join(root, 'eval-reports', 'transcripts', 'tool-live-01.json')
    expect(existsSync(transcriptPath)).toBe(true)
    expect(readFileSync(transcriptPath, 'utf8')).not.toContain(API_KEY)
  })

  it('下一次运行读取历史报告块并渲染对比表', async () => {
    const root = newDir()
    const reportsDir = join(root, 'eval-reports')
    await writeEvalReport({
      summary: makeSummary('2026-09-24T03:00:00.000Z'),
      scores: [],
      transcripts: [],
      apiKey: API_KEY,
      reportsDir,
    })

    const history = loadHistorySummaries(reportsDir, '2026-09-24T09:00:00.000Z')
    expect(history).toHaveLength(1)
    expect(history[0]?.model).toBe('eval-model')
    // 当前运行自身不被算作历史
    expect(loadHistorySummaries(reportsDir, '2026-09-24T03:00:00.000Z')).toHaveLength(0)

    const reportPath = await writeEvalReport({
      summary: makeSummary('2026-09-24T09:00:00.000Z'),
      scores: [],
      transcripts: [],
      apiKey: API_KEY,
      reportsDir,
    })
    const report = readFileSync(reportPath, 'utf8')
    expect(report).toContain('跨运行对比')
    expect(report).toContain('2026-09-24 03:00:00')
    expect(report).not.toContain(API_KEY)
  })

  it('损坏的历史 summary 块被跳过而不抛错', () => {
    const root = newDir()
    const reportsDir = join(root, 'eval-reports')
    mkdirSync(reportsDir, { recursive: true })
    writeFileSync(join(reportsDir, '2026-09-23-broken.md'), '```nf-eval-summary\n{broken\n```', 'utf8')
    expect(loadHistorySummaries(reportsDir, 'x')).toHaveLength(0)
  })
})
