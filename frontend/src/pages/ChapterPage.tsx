import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { api, toast } from '../api/client'
import type { ChapterResult, CharacterCard } from '../types'

const LAST_SESSION_KEY = 'novelforge_last_session'

export default function ChapterPage() {
  const [sessionId, setSessionId] = useState('')
  const [cards, setCards] = useState<CharacterCard[]>([])
  const [pov, setPov] = useState('')
  const [result, setResult] = useState<ChapterResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSessionId(window.localStorage.getItem(LAST_SESSION_KEY) ?? '')
    void (async () => {
      try {
        setCards(await api.get<CharacterCard[]>('/api/characters'))
      } catch {
        /* toast 已弹出 */
      }
    })()
  }, [])

  const paragraphs = useMemo(() => {
    if (!result?.content) return []
    return result.content.split(/\n/).map((p) => p.trim()).filter((p) => p.length > 0)
  }, [result])

  const handleGenerate = async () => {
    const sid = sessionId.trim()
    if (!sid) {
      toast('请输入会话 ID（或先运行一次模拟）')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await api.post<ChapterResult>('/api/chapter/rewrite', {
        session_id: sid,
        pov_character: pov.trim() ? pov.trim() : undefined,
      })
      setResult(res)
      window.localStorage.setItem(LAST_SESSION_KEY, sid)
      toast('章节生成完成', 'success')
    } catch {
      /* toast 已弹出 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-grape-900">章节阅读</h1>
      <p className="mb-5 text-sm text-grape-600">基于模拟会话，将剧情重写为可阅读的小说章节</p>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl bg-white/85 p-4 shadow-soft">
        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-grape-700">会话 ID</label>
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="例如 sim_1726000000（最近一次模拟已自动填入）"
            className="w-full rounded-xl border border-grape-200 bg-white px-3 py-2 text-sm outline-none focus:border-grape-400"
          />
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-semibold text-grape-700">视角角色（POV，可选）</label>
          <select
            value={pov}
            onChange={(e) => setPov(e.target.value)}
            className="w-full rounded-xl border border-grape-200 bg-white px-3 py-2 text-sm outline-none focus:border-grape-400"
          >
            <option value="">不指定视角</option>
            {cards.map((c) => (
              <option key={c.data.name} value={c.data.name}>
                {c.data.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void handleGenerate()}
          disabled={loading}
          className="rounded-full bg-gradient-to-r from-grape-500 to-grape-700 px-6 py-2.5 text-sm font-bold text-white shadow-lift transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '生成中…' : '✨ 生成章节'}
        </button>
      </div>

      {loading && (
        <div className="rounded-2xl bg-white/70 p-10 text-center text-grape-500 shadow-soft">
          正在把剧情重写为小说章节，请稍候…
        </div>
      )}

      {result && !loading && (
        <motion.article
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-3xl rounded-2xl bg-white/90 px-8 py-10 shadow-lift sm:px-14"
        >
          <h2 className="mb-2 text-center text-3xl font-bold tracking-wide text-grape-900">
            {result.title || '未命名章节'}
          </h2>
          <div className="mx-auto mb-8 h-0.5 w-16 rounded-full bg-grape-300" />
          <div className="space-y-5 text-justify text-[15px] leading-8 text-grape-900/90">
            {paragraphs.map((p, i) => (
              <p key={i} className="indent-8">
                {p}
              </p>
            ))}
          </div>
        </motion.article>
      )}

      {!result && !loading && (
        <div className="rounded-2xl bg-white/70 p-10 text-center shadow-soft">
          <div className="text-4xl">📖</div>
          <p className="mt-3 text-sm text-grape-600">
            输入会话 ID 后点击「生成章节」；若刚结束一场模拟，会话 ID 会自动带入。
          </p>
        </div>
      )}
    </div>
  )
}
