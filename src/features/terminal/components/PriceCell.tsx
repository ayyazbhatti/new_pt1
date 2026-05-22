import { memo, useMemo } from 'react'
import { useSymbolPrice } from '@/features/symbols/hooks/usePriceStream'
import { PriceDisplay } from './PriceDisplay'

export interface PriceCellProps {
  /** Feed key matching gateway ticks (`priceLookupKey` or `code`). */
  feedSymbol: string
  pricePrecision?: number
  className?: string
}

function formatUsd(value: number, precision: number): string {
  if (value === 0) return '$0.00'
  return `$${value.toFixed(precision)}`
}

function PriceCellImpl({ feedSymbol, pricePrecision = 2, className }: PriceCellProps) {
  const key = feedSymbol?.trim() || null
  const price = useSymbolPrice(key)
  const bidNum = price ? parseFloat(price.bid) : 0
  const askNum = price ? parseFloat(price.ask) : 0

  const bidFormatted = useMemo(() => {
    if (!price?.bid) return formatUsd(0, pricePrecision)
    const n = parseFloat(price.bid)
    return Number.isFinite(n) ? formatUsd(n, pricePrecision) : formatUsd(0, pricePrecision)
  }, [price?.bid, pricePrecision])

  const askFormatted = useMemo(() => {
    if (!price?.ask) return formatUsd(0, pricePrecision)
    const n = parseFloat(price.ask)
    return Number.isFinite(n) ? formatUsd(n, pricePrecision) : formatUsd(0, pricePrecision)
  }, [price?.ask, pricePrecision])

  return (
    <PriceDisplay
      bid={Number.isFinite(bidNum) ? bidNum : 0}
      ask={Number.isFinite(askNum) ? askNum : 0}
      bidFormatted={bidFormatted}
      askFormatted={askFormatted}
      className={className}
    />
  )
}

export const PriceCell = memo(PriceCellImpl)
