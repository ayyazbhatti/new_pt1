import { useTerminalStore } from '../store'
import { SinglePriceDisplay } from './SinglePriceDisplay'
import { TrendingUp } from 'lucide-react'

export function ChartPlaceholder() {
  const { selectedSymbol } = useTerminalStore()

  const displayPrice = selectedSymbol && selectedSymbol.numericPrice > 0
    ? selectedSymbol.numericPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—'

  return (
    <div className="h-full w-full flex-1 min-h-0 relative bg-gradient-to-br from-surface via-surface to-surface-2/30 overflow-hidden border-b border-white/5">
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}></div>

      {/* Right Price Marker - Enhanced */}
      {selectedSymbol && selectedSymbol.numericPrice > 0 && (
        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-10">
          <div className="bg-gradient-to-br from-surface-2 to-surface border border-white/5 rounded-lg px-3 py-2 shadow-lg shadow-black/20">
            <div className="text-[10px] text-muted/70 uppercase tracking-wider mb-1">Current</div>
            <SinglePriceDisplay
              price={selectedSymbol.numericPrice}
              formatted={`$${displayPrice}`}
              className="text-base"
            />
          </div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-success rounded-full border-2 border-surface shadow-lg shadow-success/50 animate-pulse"></div>
        </div>
      )}

      {/* Placeholder Content - Enhanced */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center relative z-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/10 border border-accent/30 mb-6 shadow-lg shadow-accent/10">
            <TrendingUp className="h-10 w-10 text-accent" />
          </div>
          <div className="text-xl font-bold text-text mb-2 tracking-tight">Chart Placeholder</div>
          <div className="text-sm text-muted/80">Professional trading chart will be displayed here</div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted/60">
            <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse"></div>
            <span>Real-time data visualization</span>
          </div>
        </div>
      </div>
    </div>
  )
}
