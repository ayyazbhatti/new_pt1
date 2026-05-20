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
import type { DailyFee } from '../api/dashboard.api'
import { formatCurrency } from '@/features/adminFinance/utils/formatters'

/** Matches `tailwind.config.js` theme.extend.colors.accent */
const COLOR_ACCENT = '#3b82f6'

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

interface FeeTooltipProps {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}

function FeeTooltip({ active, payload, label }: FeeTooltipProps) {
  if (!active || !payload?.length || !label) return null
  const v = Number(payload[0]?.value ?? 0)
  return (
    <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-text">{shortMonthDay(label)}</p>
      <p className="text-text">Net fees: {formatCurrency(v, 'USD')}</p>
    </div>
  )
}

export interface FeesChartProps {
  data: DailyFee[]
  loading?: boolean
}

export function FeesChart({ data, loading }: FeesChartProps) {
  const hasFees = data.some((d) => d.fees !== 0)

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center text-text-muted">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading chart" />
      </div>
    )
  }

  if (!hasFees) {
    return (
      <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-sm text-text-muted">
        No fees recorded in the last 30 days
      </div>
    )
  }

  const chartData = data.map((row) => ({ ...row, label: shortMonthDay(row.date) }))

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
          <Tooltip content={<FeeTooltip />} />
          <Area
            type="monotone"
            dataKey="fees"
            name="Net fees"
            stroke={COLOR_ACCENT}
            fill={COLOR_ACCENT}
            fillOpacity={0.22}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
