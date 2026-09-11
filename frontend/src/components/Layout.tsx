import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { PageKey } from '../App'
import { useToastStore } from '../api/client'

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'characters', label: '角色卡管理', icon: '🎭' },
  { key: 'simulation', label: '互动模拟', icon: '💬' },
  { key: 'chapter', label: '章节阅读', icon: '📖' },
  { key: 'experiments', label: '对比实验', icon: '📊' },
]

function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)
  return (
    <div className="pointer-events-none fixed left-1/2 top-20 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            initial={{ opacity: 0, y: -10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={() => remove(t.id)}
            className={`pointer-events-auto rounded-xl px-4 py-2.5 text-left text-sm shadow-lift backdrop-blur ${
              t.kind === 'error'
                ? 'bg-rose-500/90 text-white'
                : t.kind === 'success'
                  ? 'bg-emerald-500/90 text-white'
                  : 'bg-grape-600/90 text-white'
            }`}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}

interface LayoutProps {
  page: PageKey
  onNavigate: (page: PageKey) => void
  children: ReactNode
}

export default function Layout({ page, onNavigate, children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <Toasts />
      <header className="sticky top-0 z-40 border-b border-white/40 bg-white/55 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-grape-500 to-grape-700 text-lg text-white shadow-soft">
              ✒
            </span>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-wide text-grape-900">NovelForge</div>
              <div className="text-[11px] text-grape-600">多 Agent 轻小说生成工坊</div>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-1.5">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  page === item.key
                    ? 'bg-grape-600 font-semibold text-white shadow-soft'
                    : 'text-grape-800 hover:bg-white/70'
                }`}
              >
                <span className="mr-1">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      <footer className="py-4 text-center text-xs text-grape-700/70">
        NovelForge · 多 Agent 轻小说生成系统
      </footer>
    </div>
  )
}
