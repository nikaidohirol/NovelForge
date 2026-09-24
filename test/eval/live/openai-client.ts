/**
 * Agent 评测 — 最小 OpenAI 兼容客户端
 *
 * 原生 fetch 调用 /chat/completions（非流式，temperature 0.2），
 * 响应 usage 累积进 usageSink 供成本核算。
 * 模块顶层无副作用：主测试套件加载本文件不会发起任何网络请求。
 * 错误消息只包含状态码与响应摘要，绝不包含 API key。
 */

import type { LLMGenerateFn } from '../../../src/services/agent/agent-engine'
import type { EvalLiveConfig, UsageRecord } from '../eval-types'

const EVAL_TEMPERATURE = 0.2

export interface EvalClient {
  /** 连接配置（key 已含在内部，报告层不得输出） */
  config: EvalLiveConfig
  generateFn: LLMGenerateFn
  /** 每次成功调用的 token 用量记录 */
  usageSink: UsageRecord[]
  /** 已发出的请求次数 */
  requestCount: () => number
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export function createOpenAICompatClient(config: EvalLiveConfig): EvalClient {
  const usageSink: UsageRecord[] = []
  let requests = 0
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  const generateFn: LLMGenerateFn = async (messages) => {
    requests += 1
    let response: Response
    try {
      response = await globalThis.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature: EVAL_TEMPERATURE,
          stream: false,
        }),
      })
    } catch (thrown) {
      throw new Error(`评测请求网络失败: ${thrown instanceof Error ? thrown.message : String(thrown)}`)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`评测请求失败: HTTP ${response.status} ${body.slice(0, 200)}`)
    }

    const data = (await response.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content ?? ''
    usageSink.push({
      model: config.model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    })
    return content
  }

  return {
    config,
    generateFn,
    usageSink,
    requestCount: () => requests,
  }
}
