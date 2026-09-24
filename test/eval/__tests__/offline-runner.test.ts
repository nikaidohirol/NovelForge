import { describe, expect, it, vi } from 'vitest'

import { runAgentCase } from '../runner/agent-case-runner'
import { runOfflineCase, runOfflineSuite } from '../runner/offline-runner'
import { loadAllCases, loadCasesByCategory } from '../cases-loader'
import type { EvalCase } from '../eval-types'

function inlineCase(partial: Partial<EvalCase>): EvalCase {
  return {
    id: partial.id ?? 'inline-case',
    category: partial.category ?? 'tool_call',
    layer: 'live',
    title: '内联用例',
    user: '读取状态',
    ...partial,
    expect: partial.expect ?? {},
  } as EvalCase
}

describe('离线执行器：任务集全量通过', () => {
  it('10 个离线用例（解析 8 + 张力合成 2）全部评分通过', () => {
    const scores = runOfflineSuite(loadAllCases())
    expect(scores).toHaveLength(10)
    for (const s of scores) {
      expect(s.passed, `${s.caseId}: ${JSON.stringify(s.checks)}`).toBe(true)
    }
  })

  it('离线执行器拒绝 live 用例', () => {
    expect(() => runOfflineCase(inlineCase({ layer: 'live' }))).toThrow(/只接受 offline 用例/)
  })
})

describe('Agent 用例执行器（mock generateFn 端到端）', () => {
  it('只读工具调用后基于结果回答，评分为通过', async () => {
    const evalCase = inlineCase({
      id: 'agent-off-01',
      tools: [{ name: 'status_probe', description: '读取状态', result: '状态良好' }],
      expect: {
        toolCalls: [{ name: 'status_probe' }],
        matchMode: 'subset',
        requireToolCall: true,
        maxRounds: 4,
      },
    })
    const generate = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"status_probe","arguments":{}}</tool_call>')
      .mockResolvedValueOnce('状态已读取，一切良好。')

    const result = await runAgentCase(evalCase, generate)

    expect(result.error).toBeUndefined()
    expect(result.rounds).toBe(2)
    expect(result.confirmationIntercepted).toBe(false)
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'status_probe', status: 'completed' })
    expect(result.budgetExhausted).toBe(false)
  })

  it('写工具触发确认门并自动批准执行', async () => {
    const evalCase = inlineCase({
      id: 'agent-off-02',
      tools: [{
        name: 'save_note',
        description: '保存备注',
        result: '备注已保存',
        requiresConfirmation: true,
      }],
      expect: {
        toolCalls: [{ name: 'save_note' }],
        matchMode: 'subset',
        requireToolCall: true,
      },
    })
    const generate = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"save_note","arguments":{"text":"樱花灯"}}</tool_call>')
      .mockResolvedValueOnce('已记录。')

    const result = await runAgentCase(evalCase, generate)

    expect(result.confirmationIntercepted).toBe(true)
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'save_note', status: 'completed' })
  })

  it('模型不调用工具时 requireToolCall 断言失败', async () => {
    const evalCase = inlineCase({
      id: 'agent-off-03',
      tools: [{ name: 'status_probe', description: '读取状态', result: '状态良好' }],
      expect: { toolCalls: [{ name: 'status_probe' }], matchMode: 'subset', requireToolCall: true },
    })
    const generate = vi.fn().mockResolvedValue('直接回答，不调用工具。')

    const result = await runAgentCase(evalCase, generate)

    expect(result.rounds).toBe(1)
    expect(result.toolCalls).toHaveLength(0)
  })

  it('generateFn 抛错时错误进入运行产物', async () => {
    const evalCase = inlineCase({ id: 'agent-off-04' })
    const result = await runAgentCase(
      evalCase,
      vi.fn(async () => { throw new Error('provider down') }),
    )
    expect(result.error).toBe('AI 请求失败，请重试。')
  })
})

describe('离线用例与加载器联动', () => {
  it('解析容错类别可从加载器直接执行', () => {
    const scores = loadCasesByCategory('parse_tolerance').map(runOfflineCase)
    expect(scores.every(s => s.passed)).toBe(true)
  })
})
