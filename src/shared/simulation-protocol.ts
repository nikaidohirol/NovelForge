/**
 * 互动模拟生成模式 — 跨进程契约与共享工具。
 *
 * 模式B：角色 Agent 在场景中自主互动（导演 Agent 控制节奏与张力），
 * 互动日志再由叙事重写阶段转写为章节草稿。
 * 「秘密」构成知识边界：发言不得泄露未知的他人秘密，违规会被拦截重生成。
 */

/** 单条角色行动 */
export interface SimulationAction {
  /** speak / move / use / observe / silence */
  actionType: string
  /** 发言或动作内容 */
  content: string
  /** 目标角色（可选） */
  target?: string
}

/** 导演评估：四维加权张力 + 干预决策 */
export interface DirectorInsight {
  /** 关系变化 0-10 */
  relationShift: number
  /** 目标冲突 0-10 */
  goalConflict: number
  /** 秘密施压 0-10 */
  secretPressure: number
  /** 事件新颖度 0-10 */
  novelty: number
  /** 加权张力 0-10 */
  tension: number
  needIntervention: boolean
  /** external_event / secret_reveal / deadline / new_character（needIntervention 时给出） */
  eventType?: string
  eventDescription?: string
}

/** 单轮互动记录 */
export interface SimulationTurn {
  index: number
  character: string
  action: SimulationAction
  /** 本条发言命中的他人秘密（拦截重生成前的违规记录） */
  secretViolations: string[]
  /** 是否经过拦截重生成 */
  regenerated: boolean
}

/** 一次完整模拟运行 */
export interface SimulationRunResult {
  characterNames: string[]
  scenario: string
  maxTurns: number
  /** 每轮张力（0-10，未评估轮沿用上一次） */
  tensionCurve: number[]
  insights: DirectorInsight[]
  turns: SimulationTurn[]
  /** 干预注入记录 */
  interventions: Array<{ turn: number; type: string; description: string }>
}

/** 张力四维加权权重（设计文档：关系0.3 / 冲突0.3 / 秘密0.2 / 新颖0.2） */
export const TENSION_WEIGHTS = Object.freeze({
  relationShift: 0.3,
  goalConflict: 0.3,
  secretPressure: 0.2,
  novelty: 0.2,
})

function clamp10(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(10, Math.max(0, Math.round(num * 10) / 10))
}

/** 四维加权张力公式 */
export function weightedTension(input: {
  relationShift: number
  goalConflict: number
  secretPressure: number
  novelty: number
}): number {
  return clamp10(
    input.relationShift * TENSION_WEIGHTS.relationShift
    + input.goalConflict * TENSION_WEIGHTS.goalConflict
    + input.secretPressure * TENSION_WEIGHTS.secretPressure
    + input.novelty * TENSION_WEIGHTS.novelty,
  )
}

/** 归一化导演返回（防御式） */
export function normalizeDirectorInsight(value: unknown): DirectorInsight {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const dims = {
    relationShift: clamp10(source.relation_shift ?? source.relationShift),
    goalConflict: clamp10(source.goal_conflict ?? source.goalConflict),
    secretPressure: clamp10(source.secret_pressure ?? source.secretPressure),
    novelty: clamp10(source.novelty),
  }
  const eventType = typeof source.event_type === 'string' ? source.event_type.trim() : ''
  const eventDescription = typeof source.event_description === 'string' ? source.event_description.trim() : ''
  const needIntervention = source.need_intervention === true || source.needIntervention === true
  return {
    ...dims,
    tension: weightedTension(dims),
    needIntervention,
    ...(needIntervention && eventType ? { eventType } : {}),
    ...(needIntervention && eventDescription ? { eventDescription } : {}),
  }
}

/** 归一化角色行动（防御式） */
export function normalizeSimulationAction(value: unknown): SimulationAction {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const allowed = new Set(['speak', 'move', 'use', 'observe', 'silence'])
  const rawType = typeof source.action_type === 'string' ? source.action_type.trim() : ''
  return {
    actionType: allowed.has(rawType) ? rawType : 'speak',
    content: typeof source.content === 'string' ? source.content.trim() : '',
    ...(typeof source.target === 'string' && source.target.trim()
      ? { target: source.target.trim() }
      : {}),
  }
}

const SECRET_MATCH_MIN_LEN = 6

/**
 * 知识边界扫描（v1 直接匹配层）：检查发言是否命中他人的秘密。
 * 命中规则：秘密原文或长度 ≥6 的连续子串出现在发言中。
 * 语义匹配层由后续审稿的一致性检查兜底。
 */
export function scanSecretViolations(
  utterance: string,
  others: Array<{ name: string; secrets: readonly string[] }>,
): string[] {
  const hits: string[] = []
  const normalizedUtterance = utterance.replace(/\s+/g, '')
  if (!normalizedUtterance) return hits
  for (const other of others) {
    for (const secret of other.secrets) {
      const normalizedSecret = secret.replace(/\s+/g, '')
      if (normalizedSecret.length < SECRET_MATCH_MIN_LEN) continue
      if (normalizedUtterance.includes(normalizedSecret)) {
        hits.push(`${other.name}: ${secret}`)
        continue
      }
      // 长秘密的滑动窗口子串匹配（容忍措辞微调）
      if (normalizedSecret.length >= SECRET_MATCH_MIN_LEN * 2) {
        const window = normalizedSecret.slice(0, SECRET_MATCH_MIN_LEN)
        const tail = normalizedSecret.slice(-SECRET_MATCH_MIN_LEN)
        if (normalizedUtterance.includes(window) && normalizedUtterance.includes(tail)) {
          hits.push(`${other.name}: ${secret}`)
        }
      }
    }
  }
  return hits
}
