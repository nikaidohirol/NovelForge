/**
 * Agent 评测 — 真实模型层套件入口
 *
 * 双重门禁：NOVELFORGE_EVAL_LIVE=1 且 BASE_URL/API_KEY/MODEL 齐全才执行，
 * 否则整个套件被跳过（`npm test` 永远不会走到这里）。
 * 12 个 live 用例串行执行，结束后写 Markdown 报告（报告入库，transcript 不入库）。
 */

import { afterAll, describe, expect, it } from 'vitest'

import { isLiveGateEnabled, readEvalLiveConfig, readPriceUsdPerMTok } from '../eval-config'
import { loadCasesByCategory } from '../cases-loader'
import { summarizeScores, applyUsage, estimateCostUsd } from '../score/summarize'
import type { CaseScore } from '../eval-types'
import { createOpenAICompatClient } from './openai-client'
import { runLiveCase, type EvalTranscript } from './live-runner'
import { writeEvalReport } from './report-writer'

const config = isLiveGateEnabled() ? readEvalLiveConfig() : null
const client = config ? createOpenAICompatClient(config) : undefined

describe.skipIf(!config)('Agent 评测（真实模型层）', () => {
  const scores: CaseScore[] = []
  const transcripts: EvalTranscript[] = []

  afterAll(async () => {
    if (!config || !client) return
    const summary = summarizeScores(scores, { model: config.model, layer: 'live' })
    applyUsage(summary, client.usageSink)
    const price = readPriceUsdPerMTok()
    summary.estimatedCostUsd = estimateCostUsd(summary, {
      priceInputUsdPerMTok: price.input,
      priceOutputUsdPerMTok: price.output,
    })
    const reportPath = await writeEvalReport({
      summary,
      scores,
      transcripts,
      apiKey: config.apiKey,
    })
    console.log(`评测报告已写入: ${reportPath}`)
  })

  const liveCases = [
    ...loadCasesByCategory('tool_call'),
    ...loadCasesByCategory('knowledge_boundary'),
    ...loadCasesByCategory('tension_director').filter(c => c.layer === 'live'),
  ]

  for (const evalCase of liveCases) {
    it(evalCase.id, async () => {
      const { score, transcript } = await runLiveCase(evalCase, client!)
      scores.push(score)
      transcripts.push(transcript)
      const failed = score.checks
        .filter(c => !c.passed)
        .map(c => `${c.name}: ${c.detail ?? ''}`)
        .join('; ')
      expect(score.passed, `${evalCase.id} 失败项 → ${failed}`).toBe(true)
    })
  }
})
