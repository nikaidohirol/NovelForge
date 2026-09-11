/* ===== 后端 API 契约类型定义 ===== */

export interface CharacterData {
  name: string
  description: string
  personality: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  system_prompt?: string
  post_history_instructions?: string
}

export interface CharacterCard {
  spec: string
  spec_version: string
  data: CharacterData
  goals: string[]
  knowledge_boundary: string[]
  unknown_facts: string[]
  speech_style?: string
  relations: Record<string, string>
  avatar_color: string
}

export interface Scenario {
  name?: string
  location: string
  description: string
  [key: string]: unknown
}

/* ===== 模拟控制 ===== */

export interface StartSimulationPayload {
  characters: string[]
  scenario: string | Scenario
  session_id?: string
  strategy?: string
  max_turns?: number
}

export interface StartSimulationResult {
  session_id: string
  characters: string[]
  strategy: string
}

export interface ControlResult {
  ok: boolean
  status: string
}

export interface ToolCallRecord {
  turn?: number
  character?: string
  tool?: string
  args?: Record<string, unknown>
  result_summary?: string
  latency_ms?: number
  ok?: boolean
  [key: string]: unknown
}

export interface TraceSummary {
  session_id: string
  spans: Array<Record<string, unknown>>
  cost: Record<string, unknown>
}

/* ===== 章节改写 ===== */

export interface ChapterResult {
  title: string
  content: string
  [key: string]: unknown
}

/* ===== 实验 ===== */

export interface StrategyResult {
  emergence_rate: number
  tension_mean: number
  tension_var: number
  interventions: number
  tool_call_rate: number
  judge_score: number
  cost_usd: number
  runs: Array<Record<string, unknown>>
}

export interface ExperimentsResults {
  available: boolean
  message?: string
  strategies?: Record<string, StrategyResult>
  [key: string]: unknown
}

/* ===== WebSocket 消息 ===== */

export type ClientMessage =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'stop' }
  | { type: 'set_speed'; speed: number }
  | { type: 'confirm_intervention'; approved: boolean }

export interface Intervention {
  [key: string]: unknown
}

export type ServerMessage =
  | { type: 'turn_start'; turn: number; scene: { location: string } }
  | {
      type: 'character_action'
      turn: number
      actor: string
      action_type: string
      content: string
      target?: string | null
      importance?: number
      avatar_color: string
    }
  | {
      type: 'tool_call'
      turn: number
      character: string
      tool: string
      args: Record<string, unknown>
      result_summary: string
      latency_ms: number
      ok: boolean
    }
  | { type: 'tension_update'; turn: number; tension: number; history: number[] }
  | { type: 'intervention_confirm_required'; turn: number; intervention: Intervention }
  | { type: 'intervention_decision'; turn: number; approved: boolean }
  | {
      type: 'director_intervention'
      turn: number
      /** 干预类型；注意后端 **intervention 展开会覆盖消息 type 字段 */
      intervention_type?: string
      strategy: string
      content: string
      reason: string
    }
  | { type: 'state_update'; world: Record<string, unknown> }
  | { type: 'simulation_end'; total_turns: number; reason: string }
