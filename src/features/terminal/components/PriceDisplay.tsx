import { useRef, useEffect, useState } from 'react'
import { cn } from '@/shared/utils'

interface PriceDisplayProps {
  bid: number
  ask: number
  bidFormatted: string
  askFormatted: string
  className?: string
}

type PriceDirection = 'up' | 'down'

export function PriceDisplay({ bid, ask, bidFormatted, askFormatted, className }: PriceDisplayProps) {
  const prevBidRef = useRef<number | null>(null)
  const prevAskRef = useRef<number | null>(null)
  const [bidDirection, setBidDirection] = useState<PriceDirection>('up')
  const [askDirection, setAskDirection] = useState<PriceDirection>('up')
  const [bidFlash, setBidFlash] = useState(false)
  const [askFlash, setAskFlash] = useState(false)

  useEffect(() => {
    let bidTimeout: NodeJS.Timeout | null = null
    let askTimeout: NodeJS.Timeout | null = null

    // Determine bid direction
    if (prevBidRef.current !== null && bid > 0 && prevBidRef.current > 0) {
      if (bid > prevBidRef.current) {
        setBidDirection('up')
        setBidFlash(true)
        bidTimeout = setTimeout(() => setBidFlash(false), 300)
      } else if (bid < prevBidRef.current) {
        setBidDirection('down')
        setBidFlash(true)
        bidTimeout = setTimeout(() => setBidFlash(false), 300)
      }
      // If unchanged, keep the last direction (no change needed)
    } else if (bid > 0) {
      // Initialize on first valid price - default to green (up)
      prevBidRef.current = bid
      setBidDirection('up')
    }

    // Determine ask direction
    if (prevAskRef.current !== null && ask > 0 && prevAskRef.current > 0) {
      if (ask > prevAskRef.current) {
        setAskDirection('up')
        setAskFlash(true)
        askTimeout = setTimeout(() => setAskFlash(false), 300)
      } else if (ask < prevAskRef.current) {
        setAskDirection('down')
        setAskFlash(true)
        askTimeout = setTimeout(() => setAskFlash(false), 300)
      }
      // If unchanged, keep the last direction (no change needed)
    } else if (ask > 0) {
      // Initialize on first valid price - default to green (up)
      prevAskRef.current = ask
      setAskDirection('up')
    }

    // Update refs
    if (bid > 0) prevBidRef.current = bid
    if (ask > 0) prevAskRef.current = ask

    // Cleanup timeouts
    return () => {
      if (bidTimeout) clearTimeout(bidTimeout)
      if (askTimeout) clearTimeout(askTimeout)
    }
  }, [bid, ask])

  // Get color classes based on direction - always green or red
  const getBidColor = () => {
    return bidDirection === 'up' ? 'text-success' : 'text-danger'
  }

  const getAskColor = () => {
    return askDirection === 'up' ? 'text-success' : 'text-danger'
  }

  return (
    <div className={cn('flex items-baseline gap-1.5', className)}>
      <span
        className={cn(
          'text-xs font-semibold transition-colors duration-200',
          getBidColor(),
          bidFlash && (bidDirection === 'up' ? 'price-flash-up' : 'price-flash-down')
        )}
      >
        {bidFormatted}
      </span>
      <span className="text-[10px] text-text-muted/50">/</span>
      <span
        className={cn(
          'text-xs font-medium transition-colors duration-200',
          getAskColor(),
          askFlash && (askDirection === 'up' ? 'price-flash-up' : 'price-flash-down')
        )}
      >
        {askFormatted}
      </span>
    </div>
  )
}

