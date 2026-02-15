import { memo, useMemo } from 'react'
import { useSymbolPrice } from '../hooks/usePriceStream'
import { cn } from '@/shared/utils'

interface PriceCellProps {
  symbol: string
  className?: string
}

function PriceCellComponent({ symbol, className }: PriceCellProps) {
  const symbolUpper = symbol?.toUpperCase().trim() || ''
  const price = useSymbolPrice(symbolUpper)

  // Memoize formatted prices to prevent unnecessary re-renders
  const formattedPrices = useMemo(() => {
    if (!price) return null

    // Format numbers with appropriate precision
    const formatPrice = (value: string) => {
      const num = parseFloat(value)
      if (isNaN(num)) return value
      // Use up to 8 decimal places, remove trailing zeros
      return num.toFixed(8).replace(/\.?0+$/, '')
    }

    return {
      bid: formatPrice(price.bid),
      ask: formatPrice(price.ask),
    }
  }, [price?.bid, price?.ask])

  if (!price || !formattedPrices) {
    return (
      <div className={cn('text-sm text-text-muted font-mono', className)}>
        <div className="flex flex-col gap-0.5">
          <span className="opacity-50">--</span>
          <span className="opacity-50">--</span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('text-sm font-mono', className)}>
      <div className="flex flex-col gap-0.5">
        <span className="text-success">{formattedPrices.bid}</span>
        <span className="text-danger">{formattedPrices.ask}</span>
      </div>
    </div>
  )
}

// Memoize PriceCell - prevents re-renders when parent re-renders with same props
// Internal price updates (from useSymbolPrice hook) will still trigger re-renders
export const PriceCell = memo(PriceCellComponent)

