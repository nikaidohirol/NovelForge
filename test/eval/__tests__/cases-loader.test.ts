import { describe, expect, it } from 'vitest'

import { loadAllCases, loadCasesByCategory, validateCase } from '../cases-loader'

describe('评测任务集加载器', () => {
  it('四类用例全部加载且数量正确（8/6/6/4，共 24）', () => {
    expect(loadCasesByCategory('parse_tolerance')).toHaveLength(8)
    expect(loadCasesByCategory('tool_call')).toHaveLength(6)
    expect(loadCasesByCategory('knowledge_boundary')).toHaveLength(6)
    expect(loadCasesByCategory('tension_director')).toHaveLength(4)
    expect(loadAllCases()).toHaveLength(24)
  })

  it('用例 id 全局唯一且与类别一致', () => {
    const all = loadAllCases()
    const ids = new Set(all.map(c => c.id))
    expect(ids.size).toBe(all.length)
    for (const c of all) {
      expect(c.category).toMatch(/^parse_tolerance|tool_call|knowledge_boundary|tension_director$/)
      expect(c.expect).toBeTypeOf('object')
    }
  })

  it('层级配对约束：离线用例带预设输出，live 用例带用户消息', () => {
    for (const c of loadAllCases()) {
      if (c.layer === 'offline') {
        expect(c.offlineOutput, c.id).toBeTypeOf('string')
      } else {
        expect(c.user, c.id).toBeTypeOf('string')
      }
    }
  })

  it('知识边界用例的发言者是 characters[0] 且他人持有秘密', () => {
    for (const c of loadCasesByCategory('knowledge_boundary')) {
      expect(c.characters?.length, c.id).toBeGreaterThanOrEqual(2)
      const others = c.characters?.slice(1) ?? []
      expect(others.every(o => o.secrets.length > 0), c.id).toBe(true)
    }
  })

  it('live 用例的桩工具定义完整', () => {
    for (const c of loadCasesByCategory('tool_call')) {
      if ((c.expect.requireToolCall ?? true) && c.id !== 'tool-live-03') {
        expect(c.tools?.length, c.id).toBeGreaterThan(0)
        for (const t of c.tools ?? []) {
          expect(t.name).toBeTypeOf('string')
          expect(t.result).toBeTypeOf('string')
        }
      }
    }
  })

  it('validateCase 拒绝缺 expect 的用例', () => {
    expect(() => validateCase({ id: 'x', category: 'tool_call', layer: 'live' }, 'inline'))
      .toThrow(/\[x\]/)
  })

  it('validateCase 拒绝类别与层级错配', () => {
    expect(() => validateCase({
      id: 'y', category: 'tool_call', layer: 'offline', title: 't',
      offlineOutput: 'x', user: 'u', expect: {},
    }, 'inline')).toThrow(/tool_call 用例必须是 live 层/)
  })

  it('validateCase 拒绝知识边界用例少于两个角色', () => {
    expect(() => validateCase({
      id: 'z', category: 'knowledge_boundary', layer: 'live', title: 't',
      user: 'u', characters: [{ name: 'a', secrets: ['secret-a-long'] }], expect: {},
    }, 'inline')).toThrow(/至少两个角色/)
  })
})
