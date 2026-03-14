import { useMemo } from 'react'

const CHART_HEIGHT = 200
const PADDING = { top: 12, right: 12, bottom: 28, left: 40 }

/** Sample monthly revenue data (placeholder – replace with API data later) */
const SAMPLE_DATA = [
  { label: 'Jan', value: 38200 },
  { label: 'Feb', value: 40100 },
  { label: 'Mar', value: 38900 },
  { label: 'Apr', value: 42500 },
  { label: 'May', value: 43800 },
  { label: 'Jun', value: 41200 },
  { label: 'Jul', value: 45678 },
]

interface RevenueChartProps {
  data?: { label: string; value: number }[]
  height?: number
  className?: string
}

export function RevenueChart({
  data = SAMPLE_DATA,
  height = CHART_HEIGHT,
  className = '',
}: RevenueChartProps) {
  const { path, areaPath, xLabels } = useMemo(() => {
    const width = 400
    const chartWidth = width - PADDING.left - PADDING.right
    const chartHeight = height - PADDING.top - PADDING.bottom

    const values = data.map((d) => d.value)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    const range = maxVal - minVal || 1
    const padding = range * 0.1
    const minY = minVal - padding
    const maxY = maxVal + padding
    const scaleY = (v: number) =>
      PADDING.top + chartHeight - ((v - minY) / (maxY - minY)) * chartHeight
    const scaleX = (i: number) =>
      PADDING.left + (i / Math.max(data.length - 1, 1)) * chartWidth

    const points = data.map((d, i) => `${scaleX(i)},${scaleY(d.value)}`)
    const path = `M ${points.join(' L ')}`
    const areaPath = `${path} L ${scaleX(data.length - 1)},${PADDING.top + chartHeight} L ${PADDING.left},${PADDING.top + chartHeight} Z`

    const xLabels = data.map((d, i) => ({
      label: d.label,
      x: scaleX(i),
    }))

    return { path, areaPath, xLabels }
  }, [data, height])

  return (
    <div className={`w-full overflow-hidden ${className}`}>
      <svg
        viewBox={`0 0 400 ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full min-h-[200px]"
      >
        <defs>
          <linearGradient id="revenue-chart-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path
          d={areaPath}
          fill="url(#revenue-chart-gradient)"
        />
        {/* Line */}
        <path
          d={path}
          fill="none"
          stroke="rgb(59, 130, 246)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* X-axis labels */}
        {xLabels.map((item, i) => (
          <text
            key={i}
            x={item.x}
            y={height - 6}
            textAnchor="middle"
            className="text-[10px] fill-current text-text-muted"
          >
            {item.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
