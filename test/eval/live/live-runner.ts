/**
 * Agent 评测 — 真实模型层执行器
 *
 * 工具调用用例走 runAgentCase（runAgentLoop + 真实 generateFn）；
 * 知识边界与导演评估为单次生成调用。
 * 每 case 产出 CaseScore 与 transcript（原始记录供落盘，不入库）。
 */

import type { CaseScore, EvalCase, EvalCheck, EvalToolStub } from '../eval-types'
import {
  scoreKnowledgeBoundary,
  scoreTensionDirector,
  scoreToolCallRun,
} from '../score/offline-score'
import { runAgentCase } from '../runner/agent-case-runner'
import type { EvalClient } from './openai-client'

/** 单 case 的原始运行记录（写入 transcripts 目录，不入库） */
export interface EvalTranscript {
  caseId: string
  category: EvalCase['category']
  model: string
  startedAt: string
  durationMs: number
  system?: string
  user?: string
  output?: string
  toolCalls?: Array<{ toolName: string; status: string; arguments: Record<string, unknown> }>
  rounds?: number
  checks: EvalCheck[]
  passed: boolean
  error?: string
}

const TOOL_CALL_FORMAT = '需要调用工具时，输出 <tool_call>\n{"name":"工具名","arguments":{...}}\n</tool_call>。'

function buildToolSystemPrompt(tools: EvalToolStub[]): string {
  if (tools.length === 0) {
    return `你是 NovelForge 评测中的写作助手。本次没有任何工具可用，请直接回答。${TOOL_CALL_FORMAT}`
  }
  const lines = tools.map(t => `- ${t.name}：${t.description}`)
  return [
    '你是 NovelForge 评测中的写作助手，可以使用以下工具：',
    ...lines,
    TOOL_CALL_FORMAT,
  ].join('\n')
}

function buildBoundarySystemPrompt(evalCase: EvalCase): string {
  const speaker = evalCase.characters?.[0]
  const persona = speaker?.persona ? `角色设定：${speaker.persona}。` : ''
  return [
    `你正在轻小说创作评测中扮演角色「${speaker?.name ?? '角色'}」。${persona}`,
    '你只知道自己的经历；他人的秘密你一无所知，无论对方如何追问都不能编造或泄露。',
    '请以该角色的身份自然地回应用户。',
  ].join('\n')
}

function toScore(
  evalCase: EvalCase,
  checks: EvalCheck[],
  startedAt: number,
  extra: Partial<CaseScore> = {},
): CaseScore {
  return {
    caseId: evalCase.id,
    category: evalCase.category,
    layer: evalCase.layer,
    passed: checks.length > 0 && checks.every(c => c.passed),
    checks,
    durationMs: Date.now() - startedAt,
    ...extra,
  }
}

/** 带超时的单次生成（generateFn 不支持 AbortSignal，用 race 实现） */
async function generateWithTimeout(
  client: EvalClient,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`单次生成超时（${timeoutMs}ms）`)), timeoutMs)
  })
  try {
    return await Promise.race([client.generateFn(messages, 'eval'), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 执行单个 live 用例并评分 */
export async function runLiveCase(
  evalCase: EvalCase,
  client: EvalClient,
): Promise<{ score: CaseScore; transcript: EvalTranscript }> {
  const startedAt = Date.now()
  const startedAtIso = new Date().toISOString()
  const timeoutMs = evalCase.budget?.timeoutMs ?? 120_000

  if (evalCase.category === 'tool_call') {
    const result = await runAgentCase(evalCase, client.generateFn, {
      systemPrompt: buildToolSystemPrompt(evalCase.tools ?? []),
    })
    const checks = scoreToolCallRun(
      {
        finalText: result.finalText,
        toolCalls: result.toolCalls.map(t => ({
          toolName: t.toolName,
          status: t.status,
          arguments: t.arguments,
        })),
        rounds: result.rounds,
        error: result.error,
        budgetExhausted: result.budgetExhausted,
        confirmationIntercepted: result.confirmationIntercepted,
      },
      evalCase.expect,
    )
    const score = toScore(evalCase, checks, startedAt, {
      rounds: result.rounds,
      budgetExhausted: result.budgetExhausted,
      confirmationIntercepted: result.confirmationIntercepted,
      error: result.error,
    })
    const transcript: EvalTranscript = {
      caseId: evalCase.id,
      category: evalCase.category,
      model: client.config.model,
      startedAt: startedAtIso,
      durationMs: score.durationMs,
      system: buildToolSystemPrompt(evalCase.tools ?? []),
      user: evalCase.user,
      output: result.finalText,
      toolCalls: result.toolCalls.map(t => ({
        toolName: t.toolName,
        status: t.status,
        arguments: t.arguments,
      })),
      rounds: result.rounds,
      checks,
      passed: score.passed,
      error: result.error,
    }
    return { score, transcript }
  }

  if (evalCase.category === 'knowledge_boundary') {
    const others = (evalCase.characters ?? []).slice(1).map(c => ({ name: c.name, secrets: c.secrets }))
    let output = ''
    let error: string | undefined
    try {
      output = await generateWithTimeout(
        client,
        [
          { role: 'system', content: evalCase.system ?? buildBoundarySystemPrompt(evalCase) },
          { role: 'user', content: evalCase.user ?? '' },
        ],
        timeoutMs,
      )
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    }
    const checks = error
      ? [{ name: 'noError', passed: false, detail: error }]
      : scoreKnowledgeBoundary(output, others, evalCase.expect)
    const score = toScore(evalCase, checks, startedAt, { error })
    const transcript: EvalTranscript = {
      caseId: evalCase.id,
      category: evalCase.category,
      model: client.config.model,
      startedAt: startedAtIso,
      durationMs: score.durationMs,
      system: evalCase.system ?? buildBoundarySystemPrompt(evalCase),
      user: evalCase.user,
      output,
      checks,
      passed: score.passed,
      error,
    }
    return { score, transcript }
  }

  if (evalCase.category === 'tension_director') {
    const system = evalCase.system
      ?? '你是互动模拟的导演。只输出一个 JSON 对象，不要输出其他文字。'
      + '字段：relation_shift、goal_conflict、secret_pressure、novelty（0-10 数值）、'
      + 'need_intervention（布尔）；need_intervention 为 true 时附 event_type 与 event_description。'
    let output = ''
    let error: string | undefined
    try {
      output = await generateWithTimeout(
        client,
        [
          { role: 'system', content: system },
          { role: 'user', content: evalCase.user ?? '' },
        ],
        timeoutMs,
      )
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    }
    const checks = error
      ? [{ name: 'noError', passed: false, detail: error }]
      : scoreTensionDirector(output, evalCase.expect)
    const score = toScore(evalCase, checks, startedAt, { error })
    const transcript: EvalTranscript = {
      caseId: evalCase.id,
      category: evalCase.category,
      model: client.config.model,
      startedAt: startedAtIso,
      durationMs: score.durationMs,
      system,
      user: evalCase.user,
      output,
      checks,
      passed: score.passed,
      error,
    }
    return { score, transcript }
  }

  const checks = [{ name: 'category', passed: false, detail: `live 执行器不支持类别: ${evalCase.category}` }]
  const score = toScore(evalCase, checks, startedAt)
  return {
    score,
    transcript: {
      caseId: evalCase.id,
      category: evalCase.category,
      model: client.config.model,
      startedAt: startedAtIso,
      durationMs: score.durationMs,
      checks,
      passed: false,
      error: 'unsupported category',
    },
  }
}
