import { create } from 'zustand'
import { toast } from '../api/client'
import type { ClientMessage, Intervention, ServerMessage } from '../types'

/* ===== 流式内容条目 ===== */

export interface ToolBadgeItem {
  id: number
  turn: number
  character: string
  tool: string
  result_summary: string
  latency_ms: number
  ok: boolean
}

export interface ActionItem {
  kind: 'action'
  id: number
  turn: number
  actor: string
  action_type: string
  content: string
  target?: string | null
  importance?: number
  avatar_color: string
  tools: ToolBadgeItem[]
}

export interface TurnMarkerItem {
  kind: 'turn_marker'
  id: number
  turn: number
  location: string
}

export interface StandaloneToolItem {
  kind: 'tool'
  id: number
  tool: ToolBadgeItem
}

export interface DirectorCardItem {
  kind: 'director'
  id: number
  turn: number
  type: string
  strategy: string
  content: string
  reason: string
}

export type StreamItem = ActionItem | TurnMarkerItem | StandaloneToolItem | DirectorCardItem

export interface PendingIntervention {
  turn: number
  intervention: Intervention
}

interface SimulationState {
  sessionId: string | null
  participants: string[]
  strategy: string
  wsConnected: boolean
  running: boolean
  paused: boolean
  finished: boolean
  endReason: string
  totalTurns: number
  currentTurn: number
  currentLocation: string
  stream: StreamItem[]
  tensionHistory: number[]
  pendingIntervention: PendingIntervention | null
  speed: number
  connect: (sessionId: string, participants: string[], strategy: string) => void
  disconnect: () => void
  send: (msg: ClientMessage) => void
  setSpeed: (speed: number) => void
  resolveIntervention: (approved: boolean) => void
  setPaused: (paused: boolean) => void
  reset: () => void
}

let socket: WebSocket | null = null
let uid = 0
function nextId(): number {
  uid += 1
  return uid
}

function handleServerMessage(msg: ServerMessage, set: (partial: Partial<SimulationState>) => void): void {
  switch (msg.type) {
    case 'turn_start':
      set({
        currentTurn: msg.turn,
        currentLocation: msg.scene?.location ?? '',
        stream: [
          ...useSimStore.getState().stream,
          { kind: 'turn_marker', id: nextId(), turn: msg.turn, location: msg.scene?.location ?? '' },
        ],
      })
      break
    case 'character_action':
      set({
        stream: [
          ...useSimStore.getState().stream,
          {
            kind: 'action',
            id: nextId(),
            turn: msg.turn,
            actor: msg.actor,
            action_type: msg.action_type,
            content: msg.content,
            target: msg.target ?? null,
            importance: msg.importance,
            avatar_color: msg.avatar_color,
            tools: [],
          },
        ],
      })
      break
    case 'tool_call': {
      const badge: ToolBadgeItem = {
        id: nextId(),
        turn: msg.turn,
        character: msg.character,
        tool: msg.tool,
        result_summary: msg.result_summary,
        latency_ms: msg.latency_ms,
        ok: msg.ok,
      }
      const stream = [...useSimStore.getState().stream]
      for (let i = stream.length - 1; i >= 0; i -= 1) {
        const item = stream[i]
        if (item.kind === 'action' && item.actor === msg.character) {
          stream[i] = { ...item, tools: [...item.tools, badge] }
          set({ stream })
          return
        }
      }
      set({ stream: [...stream, { kind: 'tool', id: badge.id, tool: badge }] })
      break
    }
    case 'tension_update':
      set({ tensionHistory: msg.history })
      break
    case 'intervention_confirm_required':
      set({ pendingIntervention: { turn: msg.turn, intervention: msg.intervention } })
      break
    case 'intervention_decision':
      set({ pendingIntervention: null })
      break
    case 'director_intervention':
      set({
        stream: [
          ...useSimStore.getState().stream,
          {
            kind: 'director',
            id: nextId(),
            turn: msg.turn,
            type: msg.intervention_type ?? '',
            strategy: msg.strategy,
            content: msg.content,
            reason: msg.reason,
          },
        ],
      })
      break
    case 'state_update':
      // 世界状态快照：当前 UI 不展示，忽略即可
      break
    case 'simulation_end':
      set({
        finished: true,
        running: false,
        endReason: msg.reason,
        totalTurns: msg.total_turns,
      })
      break
    default: {
      const raw = msg as { type?: string; message?: string; turn?: number; strategy?: string; content?: string; reason?: string }
      if (raw.message !== undefined) {
        toast(raw.message, 'error')
        break
      }
      // 后端广播 director_intervention 时 **intervention 会覆盖 type 字段，
      // 导致消息类型落入 default，这里按特征字段兜底识别
      if (raw.content && raw.reason && raw.strategy) {
        set({
          stream: [
            ...useSimStore.getState().stream,
            {
              kind: 'director',
              id: nextId(),
              turn: raw.turn ?? 0,
              type: raw.type ?? '',
              strategy: raw.strategy,
              content: raw.content,
              reason: raw.reason,
            },
          ],
        })
      }
      break
    }
  }
}

export const useSimStore = create<SimulationState>((set, get) => ({
  sessionId: null,
  participants: [],
  strategy: '',
  wsConnected: false,
  running: false,
  paused: false,
  finished: false,
  endReason: '',
  totalTurns: 0,
  currentTurn: 0,
  currentLocation: '',
  stream: [],
  tensionHistory: [],
  pendingIntervention: null,
  speed: 1,

  connect: (sessionId, participants, strategy) => {
    if (socket) {
      socket.close()
      socket = null
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/simulation/${sessionId}`)
    socket = ws
    set({
      sessionId,
      participants,
      strategy,
      running: true,
      paused: false,
      finished: false,
      endReason: '',
      totalTurns: 0,
      currentTurn: 0,
      currentLocation: '',
      stream: [],
      tensionHistory: [],
      pendingIntervention: null,
      wsConnected: false,
    })
    ws.onopen = () => {
      if (socket === ws) set({ wsConnected: true })
    }
    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage
        handleServerMessage(msg, set)
      } catch {
        /* 忽略无法解析的消息 */
      }
    }
    ws.onclose = () => {
      if (socket === ws) {
        socket = null
        set({ wsConnected: false })
      }
    }
    ws.onerror = () => {
      if (socket === ws) set({ wsConnected: false })
    }
  },

  disconnect: () => {
    if (socket) {
      socket.close()
      socket = null
    }
    set({ wsConnected: false, running: false })
  },

  send: (msg) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  },

  setSpeed: (speed) => {
    set({ speed })
    get().send({ type: 'set_speed', speed })
  },

  resolveIntervention: (approved) => {
    get().send({ type: 'confirm_intervention', approved })
    set({ pendingIntervention: null })
  },

  setPaused: (paused) => set({ paused }),

  reset: () => {
    if (socket) {
      socket.close()
      socket = null
    }
    set({
      sessionId: null,
      participants: [],
      strategy: '',
      wsConnected: false,
      running: false,
      paused: false,
      finished: false,
      endReason: '',
      totalTurns: 0,
      currentTurn: 0,
      currentLocation: '',
      stream: [],
      tensionHistory: [],
      pendingIntervention: null,
      speed: 1,
    })
  },
}))
