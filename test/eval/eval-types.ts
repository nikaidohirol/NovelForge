/**
 * Agent 评测管线 — 共享类型定义
 *
 * 评测分两层：
 * - offline：纯函数评分（解析容错、张力归一化），随单元测试进 CI
 * - live：真实模型执行（工具调用、知识边界、导演评估），显式开启才跑
 */

/** 评测类别 */
export type EvalCategory =
  | 'parse_tolerance'
  | 'tool_call'
  | 'knowledge_boundary'
  | 'tension_director'

/** 执行层 */
export type EvalLayer = 'offline' | 'live'

/** 评测桩工具定义（runner 按此注册进 toolRegistry） */
export interface EvalToolStub {
  name: string
  description: string
  /** 工具固定返回内容 */
  result: string
  /** 是否需要确认门（默认 false） */
  requiresConfirmation?: boolean
}

/** 评测角色卡（知识边界类：characters[0] 为发言者，其余为秘密扫描对象） */
export interface EvalCharacter {
  name: string
  /** 发言者人格描述（仅拼进发言者系统提示，绝不包含他人秘密） */
  persona?: string
  secrets: string[]
}

/** 期望断言集合（任一 check 失败即 fail） */
export interface EvalExpectation {
  /** 期望的工具调用（parse 类精确序列，tool 类按 matchMode 匹配） */
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>
  /** toolCalls 匹配方式：exact=精确序列，subset=调用列表须包含期望项（默认 exact） */
  matchMode?: 'exact' | 'subset'
  /** parse 类：textParts 精确匹配 */
  textParts?: string[]
  /** 最终文本须包含的子串（归一化后） */
  textContains?: string[]
  /** 知识边界：期望泄露条数（默认 0） */
  secretLeaks?: number
  /** 张力区间（weightedTension 归一化后） */
  tension?: { min: number; max: number }
  /** 导演是否应干预 */
  needIntervention?: boolean
  /** 干预事件类型 */
  eventType?: string
  /** 工具调用轮次上限 */
  maxRounds?: number
  /** 是否必须发生至少一次工具调用（false 时断言零调用） */
  requireToolCall?: boolean
}

/** 单个评测用例 */
export interface EvalCase {
  id: string
  category: EvalCategory
  layer: EvalLayer
  title: string
  /** 桩工具（parse/tool 类） */
  tools?: EvalToolStub[]
  /** offline 类：预设的模型输出 */
  offlineOutput?: string
  /** live 类：系统提示覆盖（默认用评测统一提示） */
  system?: string
  /** live 类：用户消息 */
  user?: string
  /** 知识边界类角色卡 */
  characters?: EvalCharacter[]
  expect: EvalExpectation
  /** 预算（live 类；默认 rounds 8 / timeoutMs 120000） */
  budget?: { rounds?: number; timeoutMs?: number }
}

/** 单项断言结果 */
export interface EvalCheck {
  name: string
  passed: boolean
  detail?: string
}

/** 单个用例评分 */
export interface CaseScore {
  caseId: string
  category: EvalCategory
  layer: EvalLayer
  passed: boolean
  checks: EvalCheck[]
  /** 工具调用轮次（generate 次数） */
  rounds?: number
  /** 消耗 token 总数（prompt + completion） */
  tokens?: number
  durationMs: number
  error?: string
  budgetExhausted?: boolean
  /** 是否触发过确认门 */
  confirmationIntercepted?: boolean
}

/** live 客户端 token 用量记录 */
export interface UsageRecord {
  model: string
  promptTokens: number
  completionTokens: number
}

/** 真实模型层连接配置 */
export interface EvalLiveConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 一次评测运行的汇总（报告尾部嵌入，用于跨模型对比） */
export interface EvalSummary {
  generatedAt: string
  model: string
  layer: 'offline' | 'live'
  totalCases: number
  passedCases: number
  passRate: number
  /** 工具调用类细分 */
  toolCallCases?: { total: number; passed: number; avgRounds: number; budgetExhausted: number }
  /** 知识边界类细分 */
  boundaryCases?: { total: number; passed: number; leaks: number }
  /** 张力导演类细分 */
  directorCases?: { total: number; passed: number; interventions: number }
  totalTokens?: { prompt: number; completion: number }
  estimatedCostUsd?: number | null
}
