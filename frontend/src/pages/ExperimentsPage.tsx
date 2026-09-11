import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { ExperimentsResults, StrategyResult } from '../types'

const METRICS: Array<{ key: keyof StrategyResult; label: string }> = [
  { key: 'emergence_rate', label: '涌现事件率' },
  { key: 'tension_mean', label: '张力均值' },
  { key: 'interventions', label: '干预次数' },
  { key: 'tool_call_rate', label: '工具调用率' },
]

const TABLE_COLS: Array<{ key: keyof StrategyResult; label: string; fmt?: (v: unknown) => string }> = [
  { key: 'emergence_rate', label: '涌现事件率', fmt: (v) => num(v, 3) },
  { key: 'tension_mean', label: '张力均值', fmt: (v) => num(v, 3) },
  { key: 'tension_var', label: '张力方差', fmt: (v) => num(v, 3) },
  { key: 'interventions', label: '干预次数', fmt: (v) => num(v, 1) },
  { key: 'tool_call_rate', label: '工具调用率', fmt: (v) => num(v, 3) },
  { key: 'judge_score', label: '评审分', fmt: (v) => num(v, 2) },
  { key: 'cost_usd', label: '成本 (USD)', fmt: (v) => num(v, 4) },
  { key: 'runs', label: '样本数', fmt: (v) => (Array.isArray(v) ? String(v.length) : '-') },
]

function num(v: unknown, digits: number): string {
  return typeof v === 'number' ? v.toFixed(digits) : '-'
}

const BAR_COLORS = ['#7452b8', '#e8a1c4', '#5aa7d6', '#8bc4a0']

export default function ExperimentsPage() {
  const [data, setData] = useState<ExperimentsResults | null>(null)
  const [report, setReport] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<ExperimentsResults>('/api/experiments/results')
        setData(res)
      } catch {
        setData({ available: false, message: '加载实验结果失败' })
      }
      try {
        const rep = await api.get<{ report: string }>('/api/experiments/report')
        setReport(rep.report)
      } catch {
        /* 报告不存在时静默 */
      }
      setLoading(false)
    })()
  }, [])

  const strategies = data?.strategies ?? {}
  const names = useMemo(() => Object.keys(strategies), [strategies])

  const chartData = useMemo(
    () =>
      METRICS.map((m) => {
        const row: Record<string, string | number> = { metric: m.label }
        for (const name of names) {
          const v = strategies[name]?.[m.key]
          row[name] = typeof v === 'number' ? Number(v.toFixed(3)) : 0
        }
        return row
      }),
    [names, strategies],
  )

  if (loading) {
    return <div className="rounded-2xl bg-white/70 p-10 text-center text-grape-500 shadow-soft">加载中…</div>
  }

  if (!data?.available || names.length === 0) {
    return (
      <div>
        <h1 className="mb-1 text-2xl font-bold text-grape-900">对比实验</h1>
        <p className="mb-5 text-sm text-grape-600">三种导演策略的自动化对比结果</p>
        <div className="rounded-2xl bg-white/70 p-12 text-center shadow-soft">
          <div className="text-5xl">📊</div>
          <p className="mt-4 font-semibold text-grape-700">暂无实验结果</p>
          <p className="mt-1.5 text-sm text-grape-500">
            {data?.message ?? '请先运行 experiments/run_comparison.py 生成对比数据'}
          </p>
          <p className="mt-3 text-xs text-grape-400">
            运行完成后，这里将展示涌现事件率、张力曲线统计、干预次数、工具调用率等指标的分组柱状图与明细表格。
          </p>
        </div>
        {report && <ReportPreview report={report} />}
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-grape-900">对比实验</h1>
      <p className="mb-5 text-sm text-grape-600">三种导演策略（threshold / rate_based / periodic）关键指标对比</p>

      <div className="mb-5 rounded-2xl bg-white/85 p-4 shadow-soft">
        <h3 className="mb-3 text-sm font-semibold text-grape-800">📊 策略指标对比</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d8ccf2" />
            <XAxis dataKey="metric" tick={{ fontSize: 12, fill: '#5e419a' }} />
            <YAxis tick={{ fontSize: 11, fill: '#7452b8' }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #d8ccf2', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {names.map((name, i) => (
              <Bar key={name} dataKey={name} fill={BAR_COLORS[i % BAR_COLORS.length]} radius={[6, 6, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-5 overflow-x-auto rounded-2xl bg-white/85 p-4 shadow-soft">
        <h3 className="mb-3 text-sm font-semibold text-grape-800">📋 指标明细</h3>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-grape-100 text-grape-800">
              <th className="whitespace-nowrap px-3 py-2.5 text-center font-semibold">策略</th>
              {TABLE_COLS.map((c) => (
                <th key={c.key as string} className="whitespace-nowrap px-3 py-2.5 text-center font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((name) => (
              <tr key={name} className="border-b border-grape-100 last:border-b-0 hover:bg-grape-50">
                <td className="whitespace-nowrap px-3 py-2.5 text-center font-semibold text-grape-800">{name}</td>
                {TABLE_COLS.map((c) => (
                  <td key={c.key as string} className="whitespace-nowrap px-3 py-2.5 text-center text-grape-700">
                    {c.fmt ? c.fmt(strategies[name][c.key]) : String(strategies[name][c.key] ?? '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report && <ReportPreview report={report} />}
    </div>
  )
}

function ReportPreview({ report }: { report: string }) {
  return (
    <div className="rounded-2xl bg-white/85 p-4 shadow-soft">
      <h3 className="mb-3 text-sm font-semibold text-grape-800">📝 实验报告（Markdown 预览）</h3>
      <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-grape-900/95 p-4 font-mono text-xs leading-relaxed text-grape-100">
        {report}
      </pre>
    </div>
  )
}
