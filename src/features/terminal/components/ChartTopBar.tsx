import { Settings, Maximize2, Pencil, ArrowUp, ArrowDown, TrendingUp, Activity } from 'lucide-react'
import { Segmented } from '@/shared/ui'
import { useState } from 'react'
import { useTerminalStore } from '../store'
import { toast } from 'react-hot-toast'
import { cn } from '@/shared/utils'
import { SinglePriceDisplay } from './SinglePriceDisplay'

export function ChartTopBar() {
  const [chartType, setChartType] = useState('candles')
  const [timeframe, setTimeframe] = useState('1m')
  const { selectedSymbol } = useTerminalStore()

  if (!selectedSymbol) {
    return (
      <div className="shrink-0 h-14 bg-gradient-to-r from-surface via-surface to-surface-2 border-b border-white/5 px-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <span className="text-base font-bold text-text-muted">No symbol selected</span>
        </div>
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
        </div>
      </div>
    )
  }

  const displayPrice = selectedSymbol.numericPrice > 0
    ? selectedSymbol.numericPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—'

  const change24h = selectedSymbol.change24h || 0
  const isPositive = change24h >= 0
  const volume24h = selectedSymbol.volume24h || 0
  const displayVolume = volume24h >= 1000000 
    ? `$${(volume24h / 1000000).toFixed(2)}M`
    : `$${(volume24h / 1000).toFixed(2)}K`

  const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D', '1W']

  return (
    <div className="shrink-0 h-14 bg-gradient-to-r from-surface via-surface to-surface-2 border-b border-border/50 px-4 flex items-center justify-between shadow-sm">
      {/* Left: Symbol Info */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="h-1 w-1 rounded-full bg-accent"></div>
          <span className="text-lg font-bold text-text tracking-tight">{selectedSymbol.code.replace('-', '/')}</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success/20 border border-transparent">
            <Activity className="h-3 w-3 text-success animate-pulse" />
            <span className="text-[10px] font-bold text-success uppercase tracking-wider">Live</span>
          </div>
        </div>
        <div className="flex items-center gap-4 pl-4 border-l border-white/5">
          {selectedSymbol.numericPrice > 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-muted/70 uppercase tracking-wider">Price</span>
              <SinglePriceDisplay
                price={selectedSymbol.numericPrice}
                formatted={`$${displayPrice}`}
                className="text-xl"
              />
            </div>
          ) : (
            <div className="text-xl font-bold text-text-muted">—</div>
          )}
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold",
            isPositive ? "text-success bg-success/10" : "text-danger bg-danger/10"
          )}>
            {isPositive ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
            <span>{isPositive ? '+' : ''}{change24h.toFixed(2)}%</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2/50 text-xs font-semibold text-text">
            <TrendingUp className="h-3.5 w-3.5 text-muted" />
            <span>{displayVolume}</span>
          </div>
        </div>
      </div>

      {/* Right: Chart Controls */}
      <div className="flex items-center gap-3 pl-4 border-l border-white/5">
        <Segmented
          options={[
            { value: 'candles', label: 'Candles' },
            { value: 'line', label: 'Line' },
            { value: 'area', label: 'Area' },
          ]}
          value={chartType}
          onChange={setChartType}
        />
        <div className="flex items-center gap-1 bg-surface-2/50 rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "px-2.5 py-1 text-xs font-bold rounded transition-all duration-200",
                timeframe === tf
                  ? 'bg-accent text-white shadow-md shadow-accent/20'
                  : 'text-muted hover:text-text hover:bg-surface-2/50'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-surface-2/30 rounded-lg p-1">
          <button
            onClick={() => toast.info('Drawing tools coming soon')}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Drawing Tools"
          >
            <Pencil className="h-4 w-4 text-muted hover:text-text" />
          </button>
          <button
            onClick={() => toast.info('Chart settings coming soon')}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Chart Settings"
          >
            <Settings className="h-4 w-4 text-muted hover:text-text" />
          </button>
          <button
            onClick={() => toast.info('Fullscreen mode coming soon')}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Fullscreen"
          >
            <Maximize2 className="h-4 w-4 text-muted hover:text-text" />
          </button>
        </div>
      </div>
    </div>
  )
}

