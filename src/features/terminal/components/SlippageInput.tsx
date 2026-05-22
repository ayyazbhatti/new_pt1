import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/shared/utils'
import type { SlippageSource } from '@/shared/api/auth.api'

interface Props {
  value: number
  defaultBps: number
  defaultSource: SlippageSource
  isOverridden: boolean
  onChange: (bps: number, isOverride: boolean) => void
  className?: string
}

const SOURCE_LABELS: Record<SlippageSource, string> = {
  userOverride: 'your override',
  groupDefault: 'your group',
  platformDefault: 'platform default',
  hardcodedFallback: 'fallback',
}

const MAX_USER_BPS = 500

export function SlippageInput({
  value,
  defaultBps,
  defaultSource,
  isOverridden,
  onChange,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (isOverridden) setExpanded(true)
  }, [isOverridden])

  const percentValue = (value / 100).toFixed(2)

  const handlePercentChange = (raw: string) => {
    const num = parseFloat(raw)
    if (!Number.isFinite(num)) return
    const bps = Math.round(num * 100)
    if (bps < 0) return
    const capped = Math.min(bps, MAX_USER_BPS)
    onChange(capped, true)
  }

  const handleReset = () => {
    onChange(defaultBps, false)
  }

  return (
    <div className={cn('text-xs', className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex flex-wrap items-center gap-1 text-left text-slate-500 dark:text-muted hover:text-slate-700 dark:hover:text-white/80 transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
        <span className="font-medium text-slate-600 dark:text-muted/90">Advanced — max slippage: {percentValue}%</span>
        {!isOverridden && (
          <span className="text-slate-400 dark:text-white/40">({SOURCE_LABELS[defaultSource]})</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 pl-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={percentValue}
              onChange={(e) => handlePercentChange(e.target.value)}
              step="0.01"
              min={0}
              max={MAX_USER_BPS / 100}
              className="w-20 h-7 px-2 rounded bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-white text-xs border border-slate-200 dark:border-white/10 focus:border-emerald-500 focus:outline-none"
            />
            <span className="text-slate-500 dark:text-muted">%</span>
            {isOverridden && (
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
              >
                Reset to default
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 dark:text-white/40 leading-tight">
            Reject the fill if price moves more than this from the quote at submit. Cap {MAX_USER_BPS / 100}% (
            {defaultBps} bp default from {SOURCE_LABELS[defaultSource]}).
          </p>
        </div>
      )}
    </div>
  )
}
