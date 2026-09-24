/**
 * Agent 评测任务集加载器
 *
 * 从 test/eval/cases/*.json 加载固定用例，并做轻量运行时校验。
 * 校验失败直接抛错（带 case id），避免坏用例静默变成假通过。
 */

import { readFileSync } from 'node:fs'
import type {
  EvalCase,
  EvalCategory,
  EvalCharacter,
  EvalLayer,
  EvalToolStub,
} from './eval-types'

/** 类别 → 用例文件名（不含扩展名） */
const CATEGORY_FILES: Record<EvalCategory, string> = {
  parse_tolerance: 'parse-tolerance',
  tool_call: 'tool-calls',
  knowledge_boundary: 'knowledge-boundary',
  tension_director: 'tension-director',
}

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_FILES)) as Set<EvalCategory>
const VALID_LAYERS = new Set<EvalLayer>(['offline', 'live'])

/**
 * 校验并收窄单个用例
 * @throws Error（消息含 case id 或用例文件名）
 */
export function validateCase(raw: unknown, source: string): EvalCase {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`[${source}] 用例必须是对象`)
  }
  const c = raw as Record<string, unknown>
  const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : ''
  const label = id || source
  const fail = (msg: string): never => {
    throw new Error(`[${label}] ${msg}`)
  }

  if (!id) fail('缺少 id')
  if (!VALID_CATEGORIES.has(c.category as EvalCategory)) fail(`未知类别: ${String(c.category)}`)
  const category = c.category as EvalCategory
  if (!VALID_LAYERS.has(c.layer as EvalLayer)) fail(`未知执行层: ${String(c.layer)}`)
  const layer = c.layer as EvalLayer
  if (typeof c.title !== 'string' || !c.title.trim()) fail('缺少 title')
  if (!c.expect || typeof c.expect !== 'object' || Array.isArray(c.expect)) fail('缺少 expect')

  const expectFields = c.expect as Record<string, unknown>

  // 类别与层级的配对约束
  if (category === 'parse_tolerance' && layer !== 'offline') {
    fail('parse_tolerance 用例必须是 offline 层')
  }
  if (category === 'tool_call' && layer !== 'live') {
    fail('tool_call 用例必须是 live 层')
  }
  if (category === 'knowledge_boundary' && layer !== 'live') {
    fail('knowledge_boundary 用例必须是 live 层')
  }

  // 离线类必须携带预设输出
  if (layer === 'offline' && (typeof c.offlineOutput !== 'string' || !c.offlineOutput)) {
    fail('offline 用例缺少 offlineOutput')
  }

  // live 类必须携带用户消息
  if (layer === 'live' && (typeof c.user !== 'string' || !c.user.trim())) {
    fail('live 用例缺少 user 消息')
  }

  // 桩工具字段校验
  if (c.tools !== undefined) {
    if (!Array.isArray(c.tools)) fail('tools 必须是数组')
    for (const t of c.tools as unknown[]) {
      const tool = t as Partial<EvalToolStub>
      if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) {
        fail(`[${id}] tools 中存在缺少 name 的桩工具`)
      }
      if (typeof tool.description !== 'string' || typeof tool.result !== 'string') {
        fail(`[${id}] 桩工具 ${tool?.name} 缺少 description 或 result`)
      }
    }
  }

  // 知识边界类必须携带角色卡，characters[0] 为发言者
  if (category === 'knowledge_boundary') {
    const chars = c.characters as EvalCharacter[] | undefined
    if (!Array.isArray(chars) || chars.length < 2) {
      fail(`[${id}] knowledge_boundary 用例需要至少两个角色（发言者 + 秘密持有者）`)
    }
    for (const ch of chars ?? []) {
      if (!ch || typeof ch.name !== 'string' || !Array.isArray(ch.secrets)) {
        fail(`[${id}] 角色卡缺少 name 或 secrets`)
      }
    }
  }

  // 张力区间校验
  const tension = expectFields.tension as { min?: unknown; max?: unknown } | undefined
  if (tension !== undefined) {
    if (typeof tension.min !== 'number' || typeof tension.max !== 'number' || tension.min > tension.max) {
      fail(`[${id}] expect.tension 需要 min ≤ max 的数值区间`)
    }
  }

  return c as unknown as EvalCase
}

function readCaseFile(category: EvalCategory): unknown[] {
  const fileUrl = new URL(`./cases/${CATEGORY_FILES[category]}.json`, import.meta.url)
  let content: string
  try {
    content = readFileSync(fileUrl, 'utf8')
  } catch (error) {
    throw new Error(`评测用例文件读取失败: ${CATEGORY_FILES[category]}.json (${String(error)})`)
  }
  const parsed: unknown = JSON.parse(content)
  if (!Array.isArray(parsed)) {
    throw new Error(`评测用例文件必须是数组: ${CATEGORY_FILES[category]}.json`)
  }
  return parsed
}

/** 按类别加载并校验用例 */
export function loadCasesByCategory(category: EvalCategory): EvalCase[] {
  const rawList = readCaseFile(category)
  const seen = new Set<string>()
  return rawList.map(raw => {
    const evalCase = validateCase(raw, CATEGORY_FILES[category])
    if (seen.has(evalCase.id)) {
      throw new Error(`[${CATEGORY_FILES[category]}] 用例 id 重复: ${evalCase.id}`)
    }
    seen.add(evalCase.id)
    return evalCase
  })
}

/** 加载全部 4 类用例（校验全局 id 唯一） */
export function loadAllCases(): EvalCase[] {
  const all: EvalCase[] = []
  const seen = new Set<string>()
  for (const category of Object.keys(CATEGORY_FILES) as EvalCategory[]) {
    for (const evalCase of loadCasesByCategory(category)) {
      if (seen.has(evalCase.id)) {
        throw new Error(`评测用例 id 全局重复: ${evalCase.id}`)
      }
      seen.add(evalCase.id)
      all.push(evalCase)
    }
  }
  return all
}
