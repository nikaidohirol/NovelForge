/**
 * Agent 评测 — 用例执行器（离线与 live 共用）
 *
 * 负责桩工具生命周期、Agent 循环驱动与事件收集。
 * 离线层注入 mock generateFn，live 层注入真实模型客户端的 generateFn。
 */

import {
  runAgentLoop,
  type LLMGenerateFn,
  type ToolCallInfo,
} from '../../../src/services/agent/agent-engine'
import { toolRegistry, type ToolResult } from '../../../src/services/agent/tool-registry'
import type { EvalCase, EvalToolStub } from '../eval-types'

/** 一次 Agent 循环的运行产物 */
export interface AgentRunResult {
  finalText: string
  toolCalls: ToolCallInfo[]
  /** generate 调用次数（即循环轮次） */
  rounds: number
  error?: string
  budgetExhausted?: boolean
  confirmationIntercepted?: boolean
}

/** 注册评测桩工具，返回清理函数（幂等，按名去重） */
export function registerEvalTools(tools: EvalToolStub[]): () => void {
  const registered: string[] = []
  for (const tool of tools) {
    if (toolRegistry.get(tool.name)) continue
    toolRegistry.register({
      name: tool.name,
      description: tool.description,
      source: 'builtin',
      inputSchema: { type: 'object', properties: {} },
      requiresConfirmation: tool.requiresConfirmation ?? false,
      isReadOnly: !(tool.requiresConfirmation ?? false),
      execute: async (): Promise<ToolResult> => ({ success: true, content: tool.result }),
    })
    registered.push(tool.name)
  }
  return () => {
    for (const name of registered) toolRegistry.unregister(name)
  }
}

/**
 * 驱动单个用例的 Agent 循环
 *
 * - 确认门由评测器自动批准（confirmDecision），可按需拒绝
 * - 轮次预算与超时由用例 budget 控制，超时通过 AbortSignal 中止
 */
export async function runAgentCase(
  evalCase: EvalCase,
  generateFn: LLMGenerateFn,
  opts: { systemPrompt?: string; confirmDecision?: boolean } = {},
): Promise<AgentRunResult> {
  const cleanup = registerEvalTools(evalCase.tools ?? [])
  const timeoutMs = evalCase.budget?.timeoutMs ?? 120_000
  const budgetRounds = evalCase.budget?.rounds ?? 8

  const toolCalls: ToolCallInfo[] = []
  let finalText = ''
  let rounds = 0
  let error: string | undefined
  let confirmationIntercepted = false

  const wrappedGenerate: LLMGenerateFn = async (messages, modelId) => {
    rounds += 1
    return generateFn(messages, modelId)
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`用例超时（${timeoutMs}ms）`)),
    timeoutMs,
  )

  try {
    await runAgentLoop(
      opts.systemPrompt ?? '你是评测用例中的写作助手。',
      [],
      evalCase.user ?? '',
      'eval-model',
      wrappedGenerate,
      {
        onTextChunk: () => {},
        onToolCallStart: () => {},
        onToolCallComplete: toolCall => {
          const idx = toolCalls.findIndex(t => t.id === toolCall.id)
          if (idx >= 0) toolCalls[idx] = toolCall
          else toolCalls.push(toolCall)
        },
        onToolCallConfirmRequired: async () => {
          confirmationIntercepted = true
          return opts.confirmDecision ?? true
        },
        onDone: (text, calls) => {
          finalText = text
          for (const call of calls) {
            const idx = toolCalls.findIndex(t => t.id === call.id)
            if (idx >= 0) toolCalls[idx] = call
            else toolCalls.push(call)
          }
        },
        onError: message => {
          error = message
        },
      },
      controller.signal,
      {
        projectSession: null,
        selectedModelId: 'eval-model',
        writingLanguage: 'zh-CN',
        uiLocale: 'zh-CN',
      },
    )
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  } finally {
    clearTimeout(timer)
    cleanup()
  }

  return {
    finalText,
    toolCalls,
    rounds,
    error,
    budgetExhausted: rounds >= budgetRounds,
    confirmationIntercepted,
  }
}
