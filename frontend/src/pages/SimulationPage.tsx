import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, toast } from '../api/client'
import { useSimStore, type ActionItem, type StreamItem, type ToolBadgeItem } from '../store/simulation'
import type { CharacterCard, ControlResult, Scenario, StartSimulationResult } from '../types'

const STRATEGIES = [
  { value: 'threshold', label: '阈值触发（threshold）' },
  { value: 'rate_based', label: '频率控制（rate_based）' },
  { value: 'periodic', label: '周期干预（periodic）' },
]

const ACTION_LABELS: Record<string, string> = {
  speak: '对话',
  say: '对话',
  think: '内心',
  act: '行动',
  move: '移动',
  action: '行动',
  react: '反应',
}

function actionLabel(t: string): string {
  return ACTION_LABELS[t] ?? t
}

function ToolBadge({ tool }: { tool: ToolBadgeItem }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        tool.ok ? 'border-grape-200 bg-white/80 text-grape-600' : 'border-rose-200 bg-rose-50 text-rose-500'
      }`}
      title={tool.result_summary}
    >
      <span>🔧 {tool.tool}</span>
      <span className="text-grape-400">{Math.round(tool.latency_ms)}ms</span>
      <span>{tool.ok ? '✓' : '✗'}</span>
    </span>
  )
}

function ActionBubble({ item, side }: { item: ActionItem; side: 'left' | 'right' }) {
  const isLeft = side === 'left'
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, x: isLeft ? -14 : 14 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className={`flex w-full gap-2.5 ${isLeft ? 'justify-start' : 'flex-row-reverse justify-start'}`}
    >
      <span
        className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-soft"
        style={{ backgroundColor: item.avatar_color }}
      >
        {item.actor.charAt(0)}
      </span>
      <div className={`flex max-w-[78%] flex-col ${isLeft ? 'items-start' : 'items-end'}`}>
        <div className="mb-0.5 flex items-center gap-1.5 text-xs text-grape-600">
          <span className="font-semibold text-grape-800">{item.actor}</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px]"
            style={{ backgroundColor: `${item.avatar_color}22`, color: item.avatar_color }}
          >
            {actionLabel(item.action_type)}
          </span>
          {item.target && <span className="text-grape-400">→ @{item.target}</span>}
        </div>
        <div
          className="rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed text-grape-900 shadow-soft"
          style={{ backgroundColor: `${item.avatar_color}1f`, borderColor: `${item.avatar_color}55` }}
        >
          {item.content}
        </div>
        {item.tools.length > 0 && (
          <div className={`mt-1 flex max-w-full flex-wrap gap-1 ${isLeft ? 'justify-start' : 'justify-end'}`}>
            {item.tools.map((t) => (
              <ToolBadge key={t.id} tool={t} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function StreamRow({ item, sideOf }: { item: StreamItem; sideOf: (actor: string) => 'left' | 'right' }) {
  if (item.kind === 'turn_marker') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="my-2 flex items-center gap-3 text-xs text-grape-500"
      >
        <span className="h-px flex-1 bg-grape-200" />
        <span className="rounded-full bg-white/70 px-3 py-1 shadow-soft">
          第 {item.turn} 回合 · {item.location}
        </span>
        <span className="h-px flex-1 bg-grape-200" />
      </motion.div>
    )
  }
  if (item.kind === 'director') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto w-full max-w-xl rounded-2xl border-2 border-grape-400 bg-grape-50/90 p-4 text-center shadow-lift"
      >
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-grape-500">
          🎬 导演干预 · {item.type || 'intervention'} · {item.strategy}
        </div>
        <p className="text-sm leading-relaxed text-grape-900">{item.content}</p>
        <p className="mt-1.5 text-xs text-grape-500">理由：{item.reason}</p>
      </motion.div>
    )
  }
  if (item.kind === 'tool') {
    return (
      <div className="flex justify-center">
        <ToolBadge tool={item.tool} />
      </div>
    )
  }
  return <ActionBubble item={item} side={sideOf(item.actor)} />
}

function HitlCard() {
  const pending = useSimStore((s) => s.pendingIntervention)
  const resolve = useSimStore((s) => s.resolveIntervention)
  if (!pending) return null
  const itv = pending.intervention as Record<string, unknown>
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="sticky bottom-3 z-10 mx-auto w-full max-w-xl rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-lift"
    >
      <div className="mb-1.5 flex items-center gap-2 text-sm font-bold text-amber-700">
        <span className="animate-pulse">⏸</span> 需要人工确认：导演请求进行一次干预
      </div>
      <div className="mb-2.5 flex flex-wrap gap-1.5 text-xs">
        {typeof itv.type === 'string' && itv.type && (
          <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-amber-800">类型：{itv.type}</span>
        )}
        {typeof itv.strategy === 'string' && itv.strategy && (
          <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-amber-800">策略：{itv.strategy}</span>
        )}
        <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-amber-800">回合：{pending.turn}</span>
      </div>
      <div className="mb-3 flex justify-end gap-2">
        <button
          onClick={() => resolve(false)}
          className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-amber-700 shadow-soft hover:bg-amber-100"
        >
          跳过
        </button>
        <button
          onClick={() => resolve(true)}
          className="rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white shadow-soft hover:bg-amber-600"
        >
          同意干预
        </button>
      </div>
    </motion.div>
  )
}

function TensionChart() {
  const history = useSimStore((s) => s.tensionHistory)
  const data = useMemo(() => history.map((t, i) => ({ turn: i + 1, tension: t })), [history])
  if (data.length === 0) return null
  return (
    <div className="rounded-2xl bg-white/85 p-4 shadow-soft">
      <h3 className="mb-2 text-sm font-semibold text-grape-800">📈 剧情张力曲线</h3>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="tensionFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b6cd0" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#8b6cd0" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#d8ccf2" />
          <XAxis dataKey="turn" tick={{ fontSize: 11, fill: '#7452b8' }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: '#7452b8' }} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #d8ccf2', fontSize: 12 }}
            formatter={(v: number | string) => [typeof v === 'number' ? v.toFixed(2) : v, '张力']}
          />
          <Area type="monotone" dataKey="tension" stroke="#7452b8" strokeWidth={2} fill="url(#tensionFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function SimulationPage() {
  const [cards, setCards] = useState<CharacterCard[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [strategy, setStrategy] = useState('threshold')
  const [maxTurns, setMaxTurns] = useState(6)
  const [starting, setStarting] = useState(false)

  const sessionId = useSimStore((s) => s.sessionId)
  const participants = useSimStore((s) => s.participants)
  const wsConnected = useSimStore((s) => s.wsConnected)
  const running = useSimStore((s) => s.running)
  const paused = useSimStore((s) => s.paused)
  const finished = useSimStore((s) => s.finished)
  const endReason = useSimStore((s) => s.endReason)
  const totalTurns = useSimStore((s) => s.totalTurns)
  const speed = useSimStore((s) => s.speed)
  const stream = useSimStore((s) => s.stream)
  const connect = useSimStore((s) => s.connect)
  const disconnect = useSimStore((s) => s.disconnect)
  const setPaused = useSimStore((s) => s.setPaused)
  const setSpeed = useSimStore((s) => s.setSpeed)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [cs, ss] = await Promise.all([
          api.get<CharacterCard[]>('/api/characters'),
          api.get<Scenario[]>('/api/simulation/scenarios'),
        ])
        setCards(cs)
        setScenarios(ss)
      } catch {
        /* toast 已弹出 */
      }
    })()
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stream.length, paused, finished])

  const sideOf = useCallback(
    (actor: string): 'left' | 'right' => {
      const idx = participants.indexOf(actor)
      return idx % 2 === 1 ? 'right' : 'left'
    },
    [participants],
  )

  const toggleCharacter = (name: string) => {
    setSelectedNames((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    )
  }

  const handleStart = async () => {
    if (selectedNames.length < 2) {
      toast('请至少选择 2 名角色参与模拟')
      return
    }
    const scenario = scenarios[scenarioIdx]
    if (!scenario) {
      toast('请选择一个场景')
      return
    }
    setStarting(true)
    try {
      const res = await api.post<StartSimulationResult>('/api/simulation/start', {
        characters: selectedNames,
        scenario,
        strategy,
        max_turns: maxTurns,
      })
      window.localStorage.setItem('novelforge_last_session', res.session_id)
      connect(res.session_id, res.characters, res.strategy)
      toast(`模拟已开始：${res.session_id}`, 'success')
    } catch {
      /* toast 已弹出 */
    } finally {
      setStarting(false)
    }
  }

  const control = async (action: 'pause' | 'resume' | 'step' | 'stop') => {
    if (!sessionId) return
    try {
      const res = await api.post<ControlResult>(`/api/simulation/${encodeURIComponent(sessionId)}/${action}`)
      if (action === 'pause') setPaused(res.status === 'paused')
      if (action === 'resume') setPaused(false)
      if (action === 'stop') {
        disconnect()
        setPaused(false)
      }
    } catch {
      /* toast 已弹出 */
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-grape-900">互动模拟</h1>
      <p className="mb-5 text-sm text-grape-600">选择角色与场景，实时观看多 Agent 剧情推演</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        {/* 左侧配置面板 */}
        <aside className="h-fit rounded-2xl bg-white/85 p-4 shadow-soft">
          <h3 className="mb-2 text-sm font-bold text-grape-800">1. 选择角色（≥2）</h3>
          <div className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-xl bg-grape-50/60 p-2">
            {cards.length === 0 && <p className="p-2 text-xs text-grape-400">暂无角色卡，请先到角色卡管理页上传</p>}
            {cards.map((c) => (
              <label
                key={c.data.name}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white"
              >
                <input
                  type="checkbox"
                  checked={selectedNames.includes(c.data.name)}
                  onChange={() => toggleCharacter(c.data.name)}
                  className="h-4 w-4 accent-grape-600"
                />
                <span
                  className="h-5 w-5 shrink-0 rounded-full text-center text-[10px] font-bold leading-5 text-white"
                  style={{ backgroundColor: c.avatar_color }}
                >
                  {c.data.name.charAt(0)}
                </span>
                <span className="truncate text-grape-800">{c.data.name}</span>
              </label>
            ))}
          </div>

          <h3 className="mb-1.5 text-sm font-bold text-grape-800">2. 场景</h3>
          <select
            value={scenarioIdx}
            onChange={(e) => setScenarioIdx(Number(e.target.value))}
            className="mb-4 w-full rounded-xl border border-grape-200 bg-white px-3 py-2 text-sm outline-none focus:border-grape-400"
          >
            {scenarios.length === 0 && <option value={0}>（无可用场景）</option>}
            {scenarios.map((s, i) => (
              <option key={i} value={i}>
                {s.name ? `${s.name} · ${s.location}` : s.location}
              </option>
            ))}
          </select>
          {scenarios[scenarioIdx] && (
            <p className="mb-4 -mt-2 line-clamp-2 text-xs text-grape-500">{scenarios[scenarioIdx].description}</p>
          )}

          <h3 className="mb-1.5 text-sm font-bold text-grape-800">3. 导演策略</h3>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="mb-4 w-full rounded-xl border border-grape-200 bg-white px-3 py-2 text-sm outline-none focus:border-grape-400"
          >
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <h3 className="mb-1.5 text-sm font-bold text-grape-800">4. 最大回合数</h3>
          <input
            type="number"
            min={1}
            max={50}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Math.max(1, Number(e.target.value) || 1))}
            className="mb-4 w-full rounded-xl border border-grape-200 bg-white px-3 py-2 text-sm outline-none focus:border-grape-400"
          />

          <button
            onClick={() => void handleStart()}
            disabled={starting || running}
            className="w-full rounded-full bg-gradient-to-r from-grape-500 to-grape-700 py-2.5 text-sm font-bold text-white shadow-lift transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? '启动中…' : running ? '模拟进行中…' : '🚀 开始模拟'}
          </button>
        </aside>

        {/* 右侧主区 */}
        <section className="space-y-4">
          {/* 控制条 */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/85 px-4 py-3 shadow-soft">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                wsConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-grape-100 text-grape-500'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${wsConnected ? 'animate-pulse bg-emerald-500' : 'bg-grape-300'}`} />
              {wsConnected ? '已连接' : '未连接'}
            </span>
            {sessionId && <span className="max-w-[220px] truncate text-xs text-grape-500">{sessionId}</span>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                onClick={() => void control('pause')}
                disabled={!running || paused}
                className="rounded-full bg-grape-100 px-3.5 py-1.5 text-sm text-grape-700 transition hover:bg-grape-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏸ 暂停
              </button>
              <button
                onClick={() => void control('resume')}
                disabled={!running || !paused}
                className="rounded-full bg-grape-100 px-3.5 py-1.5 text-sm text-grape-700 transition hover:bg-grape-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▶ 继续
              </button>
              <button
                onClick={() => void control('step')}
                disabled={!running}
                className="rounded-full bg-grape-100 px-3.5 py-1.5 text-sm text-grape-700 transition hover:bg-grape-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏭ 单步
              </button>
              <button
                onClick={() => void control('stop')}
                disabled={!running}
                className="rounded-full bg-rose-100 px-3.5 py-1.5 text-sm text-rose-600 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏹ 停止
              </button>
              <label className="ml-1 flex items-center gap-1.5 text-xs text-grape-600">
                速度
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.5}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-24 accent-grape-600"
                />
                <span className="w-7 font-semibold text-grape-800">{speed}x</span>
              </label>
            </div>
          </div>

          {/* 气泡流 */}
          <div
            ref={scrollRef}
            className="h-[460px] space-y-3 overflow-y-auto rounded-2xl bg-white/60 p-4 shadow-soft"
          >
            {stream.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-grape-400">
                <div className="text-5xl">💬</div>
                <p className="mt-3 text-sm">配置好角色与场景后点击「开始模拟」</p>
                <p className="text-xs">剧情将以对话气泡形式实时呈现</p>
              </div>
            )}
            <AnimatePresence initial={false}>
              {stream.map((item) => (
                <StreamRow key={item.id} item={item} sideOf={sideOf} />
              ))}
            </AnimatePresence>
            {finished && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mx-auto mt-3 w-full max-w-md rounded-2xl border border-grape-300 bg-gradient-to-r from-grape-100 to-grape-200 p-4 text-center shadow-soft"
              >
                <p className="text-sm font-bold text-grape-800">
                  🎉 模拟已结束（共 {totalTurns} 回合，原因：{endReason || '正常完成'}）
                </p>
                <p className="mt-1 text-xs text-grape-600">可前往「章节阅读」页，基于该会话生成小说章节</p>
              </motion.div>
            )}
          </div>

          {/* HITL 确认 */}
          <AnimatePresence>
            <HitlCard />
          </AnimatePresence>

          <TensionChart />
        </section>
      </div>
    </div>
  )
}
