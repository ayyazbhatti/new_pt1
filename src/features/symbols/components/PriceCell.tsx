import { memo, useEffect } from 'react'
import { useSymbolPrice } from '../hooks/usePriceStream'
import { cn } from '@/shared/utils'

interface PriceCellProps {
  symbol: string
  className?: string
}

function PriceCellComponent({ symbol, className }: PriceCellProps) {
  const symbolUpper = symbol?.toUpperCase().trim() || ''
  const price = useSymbolPrice(symbolUpper)

  // Debug: Log when price changes
  useEffect(() => {
    if (symbolUpper) {
      if (price) {
        console.log(`✅ PriceCell("${symbol}" -> "${symbolUpper}"): Price available`, price)
        console.log(`✅ PriceCell: Bid=${price.bid}, Ask=${price.ask}`)
      } else {
        console.log(`⚠️ PriceCell("${symbol}" -> "${symbolUpper}"): No price data`)
      }
    } else {
      console.warn(`⚠️ PriceCell: Empty symbol provided`)
    }
  }, [symbol, symbolUpper, price])

  if (!price) {
    return (
      <div className={cn('text-sm text-text-muted font-mono', className)}>
        <div className="flex flex-col gap-0.5">
          <span className="opacity-50">--</span>
          <span className="opacity-50">--</span>
        </div>
      </div>
    )
  }

  // Format numbers with appropriate precision
  const formatPrice = (value: string) => {
    const num = parseFloat(value)
    if (isNaN(num)) return value
    // Use up to 8 decimal places, remove trailing zeros
    return num.toFixed(8).replace(/\.?0+$/, '')
  }

  return (
    <div className={cn('text-sm font-mono', className)}>
      <div className="flex flex-col gap-0.5">
        <span className="text-success">{formatPrice(price.bid)}</span>
        <span className="text-danger">{formatPrice(price.ask)}</span>
      </div>
    </div>
  )
}

// Don't memoize - we want re-renders when price changes
export const PriceCell = PriceCellComponent

