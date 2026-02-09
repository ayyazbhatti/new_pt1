import { Settings, Maximize2, Pencil, ArrowUp, ArrowDown, TrendingUp } from 'lucide-react'
import { Segmented } from '@/shared/ui'
import { useState } from 'react'
import { useTerminalStore } from '../store'
import { toast } from 'react-hot-toast'
import { cn } from '@/shared/utils'

export function ChartTopBar() {
  const [chartType, setChartType] = useState('candles')
  const [timeframe, setTimeframe] = useState('1m')
  const { selectedSymbol } = useTerminalStore()

  const displayPrice = selectedSymbol.numericPrice.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const change24h = selectedSymbol.change24h || 0
  const isPositive = change24h >= 0
  const volume24h = selectedSymbol.volume24h || 0
  const displayVolume = volume24h >= 1000000 
    ? `$${(volume24h / 1000000).toFixed(2)}M`
    : `$${(volume24h / 1000).toFixed(2)}K`

  const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D', '1W']

  return (
    <div className="shrink-0 h-14 bg-surface border-b border-border px-4 flex items-center justify-between">
      {/* Left: Symbol Info */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-text">{selectedSymbol.code.replace('-', '/')}</span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-success/20">
            <div className="h-1.5 w-1.5 rounded-full bg-success"></div>
            <span className="text-xs text-success">Live</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-lg font-semibold text-text">${displayPrice}</div>
          <div className={cn(
            "flex items-center gap-1 text-sm font-medium",
            isPositive ? "text-success" : "text-danger"
          )}>
            {isPositive ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
            <span>{isPositive ? '+' : ''}{change24h.toFixed(2)}%</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted">
            <TrendingUp className="h-3 w-3" />
            <span>{displayVolume}</span>
          </div>
        </div>
      </div>

      {/* Right: Chart Controls */}
      <div className="flex items-center gap-3">
        <Segmented
          options={[
            { value: 'candles', label: 'Candles' },
            { value: 'line', label: 'Line' },
            { value: 'area', label: 'Area' },
          ]}
          value={chartType}
          onChange={setChartType}
        />
        <div className="flex items-center gap-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                timeframe === tf
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-text hover:bg-surface-2'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
        <button
          onClick={() => toast.info('Drawing tools coming soon')}
          className="p-1.5 hover:bg-surface-2 rounded transition-colors"
          title="Drawing Tools"
        >
          <Pencil className="h-4 w-4 text-muted" />
        </button>
        <button
          onClick={() => toast.info('Chart settings coming soon')}
          className="p-1.5 hover:bg-surface-2 rounded transition-colors"
          title="Chart Settings"
        >
          <Settings className="h-4 w-4 text-muted" />
        </button>
        <button
          onClick={() => toast.info('Fullscreen mode coming soon')}
          className="p-1.5 hover:bg-surface-2 rounded transition-colors"
          title="Fullscreen"
        >
          <Maximize2 className="h-4 w-4 text-muted" />
        </button>
      </div>
    </div>
  )
}

