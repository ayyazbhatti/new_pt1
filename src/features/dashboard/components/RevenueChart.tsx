import { Loader2 } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyFlow } from '../api/dashboard.api'

export type FormatMoneyFn = (amount: number | string | null | undefined) => string

/** Matches `tailwind.config.js` theme.extend.colors */
const COLOR_SUCCESS = '#22c55e'
const COLOR_DANGER = '#ef4444'

function shortMonthDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function abbreviateUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${sign}$${(v / 1_000).toFixed(1)}k`
  return `${sign}$${v.toFixed(0)}`
}

interface FlowTooltipProps {
  active?: boolean
  payload?: { dataKey: string; value: number; color: string }[]
  label?: string
  formatMoney: FormatMoneyFn
}

function FlowTooltip({ active, payload, label, formatMoney }: FlowTooltipProps) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-text">{shortMonthDay(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-text" style={{ color: p.color }}>
          {p.dataKey === 'deposits' ? 'Deposits' : 'Withdrawals'}: {formatMoney(Number(p.value))}
        </p>
      ))}
    </div>
  )
}

export interface RevenueChartProps {
  data: DailyFlow[]
  loading?: boolean
  formatMoney: FormatMoneyFn
}

export function RevenueChart({ data, loading, formatMoney }: RevenueChartProps) {
  const hasFlow = data.some((d) => d.deposits > 0 || d.withdrawals > 0)

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center text-text-muted">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading chart" />
      </div>
    )
  }

  if (!hasFlow) {
    return (
      <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-sm text-text-muted">
        No transactions in the last 30 days
      </div>
    )
  }

  const chartData = data.map((row) => ({
    ...row,
    label: shortMonthDay(row.date),
  }))

  return (
    <div className="h-[240px] w-full min-h-[220px] text-text-muted">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortMonthDay}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => abbreviateUsd(v)}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<FlowTooltip formatMoney={formatMoney} />} />
          <Area
            type="monotone"
            dataKey="deposits"
            name="Deposits"
            stroke={COLOR_SUCCESS}
            fill={COLOR_SUCCESS}
            fillOpacity={0.25}
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="withdrawals"
            name="Withdrawals"
            stroke={COLOR_DANGER}
            fill={COLOR_DANGER}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
