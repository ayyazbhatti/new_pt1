import { useTerminalStore } from '../store'

export function ChartPlaceholder() {
  const { selectedSymbol } = useTerminalStore()

  const displayPrice = selectedSymbol.numericPrice.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <div className="h-full w-full flex-1 min-h-0 relative bg-surface overflow-hidden">
      {/* Right Price Marker */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        <div className="bg-surface border border-border rounded px-2 py-1">
          <div className="text-xs font-medium text-success">${displayPrice}</div>
        </div>
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-2 h-2 bg-success rounded-full border-2 border-surface"></div>
      </div>

      {/* Placeholder Text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">📈</div>
          <div className="text-lg font-semibold text-text mb-2">Chart Placeholder</div>
          <div className="text-sm text-muted">Trading chart will be displayed here</div>
        </div>
      </div>
    </div>
  )
}
