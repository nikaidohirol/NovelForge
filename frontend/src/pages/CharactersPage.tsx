import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api, toast } from '../api/client'
import type { CharacterCard } from '../types'

function Avatar({ name, color, size = 'h-12 w-12 text-lg' }: { name: string; color: string; size?: string }) {
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-bold text-white shadow-soft`}
      style={{ backgroundColor: color }}
    >
      {name.charAt(0)}
    </span>
  )
}

function Tag({ text, tone = 'grape' }: { text: string; tone?: 'grape' | 'amber' | 'sky' }) {
  const tones: Record<string, string> = {
    grape: 'bg-grape-100 text-grape-700',
    amber: 'bg-amber-100 text-amber-700',
    sky: 'bg-sky-100 text-sky-700',
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>{text}</span>
}

function DetailDrawer({ card, onClose }: { card: CharacterCard; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-end bg-grape-900/30 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.aside
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-lift"
        initial={{ x: 60 }}
        animate={{ x: 0 }}
        exit={{ x: 60 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={card.data.name} color={card.avatar_color} size="h-14 w-14 text-xl" />
            <div>
              <h2 className="text-xl font-bold text-grape-900">{card.data.name}</h2>
              <p className="text-xs text-grape-500">
                {card.spec} · v{card.spec_version}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-grape-100 px-3 py-1.5 text-sm text-grape-700 hover:bg-grape-200"
          >
            关闭
          </button>
        </div>

        <section className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-grape-700">简介</h3>
          <p className="whitespace-pre-wrap rounded-xl bg-grape-50 p-3 text-sm leading-relaxed">
            {card.data.description || '（暂无）'}
          </p>
        </section>
        <section className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-grape-700">性格</h3>
          <p className="whitespace-pre-wrap rounded-xl bg-grape-50 p-3 text-sm leading-relaxed">
            {card.data.personality || '（暂无）'}
          </p>
        </section>
        <section className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold text-grape-700">目标</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-grape-800">
            {card.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </section>
        <section className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold text-grape-700">知识边界</h3>
          <div className="flex flex-wrap gap-1.5">
            {card.knowledge_boundary.map((k, i) => (
              <Tag key={i} text={k} tone="sky" />
            ))}
          </div>
        </section>
        <section className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold text-grape-700">未知事实</h3>
          <div className="flex flex-wrap gap-1.5">
            {card.unknown_facts.map((k, i) => (
              <Tag key={i} text={k} tone="amber" />
            ))}
          </div>
        </section>
        {card.speech_style && (
          <section className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-grape-700">说话风格</h3>
            <p className="rounded-xl bg-grape-50 p-3 text-sm">{card.speech_style}</p>
          </section>
        )}
        <section className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold text-grape-700">人物关系</h3>
          {Object.keys(card.relations).length === 0 ? (
            <p className="text-sm text-grape-400">（暂无）</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(card.relations).map(([name, desc]) => (
                <li key={name} className="rounded-lg bg-grape-50 px-3 py-1.5">
                  <span className="font-semibold text-grape-700">{name}</span>：{desc}
                </li>
              ))}
            </ul>
          )}
        </section>
        {card.data.system_prompt && (
          <section className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-grape-700">System Prompt</h3>
            <pre className="whitespace-pre-wrap rounded-xl bg-grape-900/90 p-3 text-xs leading-relaxed text-grape-100">
              {card.data.system_prompt}
            </pre>
          </section>
        )}
      </motion.aside>
    </motion.div>
  )
}

export default function CharactersPage() {
  const [cards, setCards] = useState<CharacterCard[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CharacterCard | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.get<CharacterCard[]>('/api/characters')
      setCards(list)
    } catch {
      /* toast 已弹出 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      let card: CharacterCard
      try {
        card = JSON.parse(String(reader.result)) as CharacterCard
      } catch {
        toast('文件内容不是合法的 JSON')
        return
      }
      if (!card?.data?.name) {
        toast('JSON 缺少 data.name 字段，不是有效的角色卡')
        return
      }
      try {
        await api.post('/api/characters', card)
        toast(`角色卡「${card.data.name}」已导入`, 'success')
        await load()
      } catch {
        /* toast 已弹出 */
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleDelete = async (name: string) => {
    try {
      await api.del(`/api/characters/${encodeURIComponent(name)}`)
      toast(`角色卡「${name}」已删除`, 'success')
      await load()
    } catch {
      /* toast 已弹出 */
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-grape-900">角色卡管理</h1>
          <p className="mt-0.5 text-sm text-grape-600">管理参与模拟的角色卡（Character Card）</p>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleUpload} />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-full bg-grape-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-grape-700"
        >
          ⬆ 上传角色卡 JSON
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white/70 p-10 text-center text-grape-500 shadow-soft">加载中…</div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl bg-white/70 p-10 text-center shadow-soft">
          <div className="text-4xl">🎭</div>
          <p className="mt-3 text-grape-600">还没有角色卡，点击右上角上传 JSON 文件创建吧！</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence>
            {cards.map((card) => (
              <motion.div
                key={card.data.name}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className="group cursor-pointer rounded-2xl bg-white/85 p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
                onClick={() => setSelected(card)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar name={card.data.name} color={card.avatar_color} />
                    <div>
                      <h3 className="font-bold text-grape-900">{card.data.name}</h3>
                      <p className="text-xs text-grape-500">{card.spec}</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(card.data.name)
                    }}
                    className="rounded-full px-2 py-1 text-xs text-grape-300 transition hover:bg-rose-50 hover:text-rose-500"
                    title="删除该角色卡"
                  >
                    删除
                  </button>
                </div>
                <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-grape-700">{card.data.personality}</p>
                <div className="mt-2 space-y-1 text-xs text-grape-600">
                  {card.goals.slice(0, 2).map((g, i) => (
                    <p key={i} className="truncate">
                      🎯 {g}
                    </p>
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {card.knowledge_boundary.slice(0, 3).map((k, i) => (
                    <Tag key={i} text={k} tone="sky" />
                  ))}
                  {card.knowledge_boundary.length > 3 && <Tag text={`+${card.knowledge_boundary.length - 3}`} />}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {selected && <DetailDrawer card={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
