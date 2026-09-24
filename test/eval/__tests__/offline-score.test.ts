import { describe, expect, it } from 'vitest'

import {
  extractDirectorJson,
  normalizeText,
  scoreKnowledgeBoundary,
  scoreParseTolerance,
  scoreToolCallRun,
  scoreTensionDirector,
} from '../score/offline-score'

describe('normalizeText', () => {
  it('去空白并统一全半角标点', () => {
    expect(normalizeText('你好， 世界。\n第二行')).toBe('你好,世界.第二行')
    expect(normalizeText('「樱花灯」')).toBe('樱花灯')
  })
})

describe('scoreParseTolerance', () => {
  it('精确匹配通过', () => {
    const checks = scoreParseTolerance(
      { textParts: ['说明'], toolCalls: [{ name: 'read_blueprint', arguments: { chapter_number: 2 } }] },
      {
        toolCalls: [{ name: 'read_blueprint', arguments: { chapter_number: 2 } }],
        textParts: ['说明'],
      },
    )
    expect(checks.every(c => c.passed)).toBe(true)
  })

  it('参数不一致时失败并给出明细', () => {
    const checks = scoreParseTolerance(
      { textParts: [], toolCalls: [{ name: 'read_blueprint', arguments: { chapter_number: 3 } }] },
      { toolCalls: [{ name: 'read_blueprint', arguments: { chapter_number: 2 } }] },
    )
    expect(checks[0]?.passed).toBe(false)
    expect(checks[0]?.detail).toContain('chapter_number')
  })

  it('subset 模式允许额外调用', () => {
    const checks = scoreParseTolerance(
      {
        textParts: [],
        toolCalls: [
          { name: 'list_chapters', arguments: {} },
          { name: 'read_blueprint', arguments: {} },
        ],
      },
      { toolCalls: [{ name: 'read_blueprint' }], matchMode: 'subset' },
    )
    expect(checks[0]?.passed).toBe(true)
  })
})

describe('scoreKnowledgeBoundary', () => {
  const others = [{ name: '绫音', secrets: ['她是夜之国流亡的公主'] }]

  it('未泄露时通过', () => {
    const checks = scoreKnowledgeBoundary('今天天气不错。', others, { secretLeaks: 0 })
    expect(checks.every(c => c.passed)).toBe(true)
  })

  it('直接命中秘密原文时失败', () => {
    const checks = scoreKnowledgeBoundary('其实她是夜之国流亡的公主。', others, { secretLeaks: 0 })
    const leak = checks.find(c => c.name === 'secretLeaks')
    expect(leak?.passed).toBe(false)
    expect(leak?.detail).toContain('绫音')
  })

  it('长秘密滑动窗口命中措辞微调的复述', () => {
    const longSecrets = [{ name: '千岁', secrets: ['她已经把这个夏天重活了三次'] }]
    const checks = scoreKnowledgeBoundary(
      '我听说她已经把这个夏天的事记成了夏天重活了三次的样子',
      longSecrets,
      { secretLeaks: 0 },
    )
    expect(checks.find(c => c.name === 'secretLeaks')?.passed).toBe(false)
  })

  it('空发言记为未响应', () => {
    const checks = scoreKnowledgeBoundary('  ', others, {})
    expect(checks.find(c => c.name === 'responded')?.passed).toBe(false)
  })
})

describe('extractDirectorJson', () => {
  it('剥离 markdown 围栏与前后散文', () => {
    const raw = extractDirectorJson('评估如下\n```json\n{"novelty": 5}\n```\n完毕')
    expect(raw).toEqual({ novelty: 5 })
  })

  it('无 JSON 时返回 undefined', () => {
    expect(extractDirectorJson('无法评估')).toBeUndefined()
  })
})

describe('scoreTensionDirector', () => {
  it('正常 JSON 按区间与判定断言', () => {
    const checks = scoreTensionDirector(
      '{"relation_shift": 7, "goal_conflict": 8, "secret_pressure": 5, "novelty": 6, "need_intervention": true, "event_type": "plot_twist"}',
      { tension: { min: 6.5, max: 7.0 }, needIntervention: true, eventType: 'plot_twist' },
    )
    expect(checks.every(c => c.passed)).toBe(true)
  })

  it('异常字段被钳制后再断言', () => {
    const checks = scoreTensionDirector(
      '{"relation_shift": "9", "goal_conflict": -3, "novelty": 99, "needIntervention": false}',
      { tension: { min: 4.5, max: 5.0 }, needIntervention: false },
    )
    expect(checks.every(c => c.passed)).toBe(true)
  })

  it('无法解析 JSON 时整体失败', () => {
    const checks = scoreTensionDirector('张力很高', { needIntervention: true })
    expect(checks[0]?.name).toBe('directorJson')
    expect(checks[0]?.passed).toBe(false)
  })
})

describe('scoreToolCallRun', () => {
  it('带错误结果直接短路失败', () => {
    const checks = scoreToolCallRun(
      { finalText: '', toolCalls: [], rounds: 1, error: 'boom' },
      { requireToolCall: true },
    )
    expect(checks).toHaveLength(1)
    expect(checks[0]?.name).toBe('noError')
    expect(checks[0]?.passed).toBe(false)
  })

  it('requireToolCall=false 时断言零调用', () => {
    const checks = scoreToolCallRun(
      { finalText: '回答', toolCalls: [], rounds: 1 },
      { requireToolCall: false },
    )
    expect(checks.find(c => c.name === 'noToolCall')?.passed).toBe(true)
  })

  it('意外调用工具时失败', () => {
    const checks = scoreToolCallRun(
      {
        finalText: '回答',
        toolCalls: [{ toolName: 'list_chapters', status: 'completed', arguments: {} }],
        rounds: 2,
      },
      { requireToolCall: false },
    )
    expect(checks.find(c => c.name === 'noToolCall')?.passed).toBe(false)
  })

  it('轮次超限与预算耗尽联动失败', () => {
    const checks = scoreToolCallRun(
      { finalText: '', toolCalls: [], rounds: 5, budgetExhausted: true },
      { maxRounds: 4 },
    )
    expect(checks.find(c => c.name === 'maxRounds')?.passed).toBe(false)
  })

  it('回答缺关键物件时 textContains 失败', () => {
    const checks = scoreToolCallRun(
      {
        finalText: '走廊上什么都没有。',
        toolCalls: [{ toolName: 'status_probe', status: 'completed', arguments: {} }],
        rounds: 2,
      },
      { textContains: ['樱花灯'] },
    )
    expect(checks.find(c => c.name?.startsWith('textContains'))?.passed).toBe(false)
  })

  it('全项通过', () => {
    const checks = scoreToolCallRun(
      {
        finalText: '走廊上挂着樱花灯。',
        toolCalls: [{ toolName: 'status_probe', status: 'completed', arguments: {} }],
        rounds: 2,
      },
      { toolCalls: [{ name: 'status_probe' }], requireToolCall: true, textContains: ['樱花灯'], maxRounds: 4 },
    )
    expect(checks.every(c => c.passed)).toBe(true)
  })
})
