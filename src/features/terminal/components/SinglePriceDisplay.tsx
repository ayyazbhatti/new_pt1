import { useRef, useEffect, useState } from 'react'
import { cn } from '@/shared/utils'

interface SinglePriceDisplayProps {
  price: number
  formatted: string
  className?: string
}

type PriceDirection = 'up' | 'down'

export function SinglePriceDisplay({ price, formatted, className }: SinglePriceDisplayProps) {
  const prevPriceRef = useRef<number | null>(null)
  const [direction, setDirection] = useState<PriceDirection>('up')
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null

    if (prevPriceRef.current !== null && price > 0 && prevPriceRef.current > 0) {
      if (price > prevPriceRef.current) {
        setDirection('up')
        setFlash(true)
        timeout = setTimeout(() => setFlash(false), 300)
      } else if (price < prevPriceRef.current) {
        setDirection('down')
        setFlash(true)
        timeout = setTimeout(() => setFlash(false), 300)
      }
    } else if (price > 0) {
      prevPriceRef.current = price
      setDirection('up')
    }

    if (price > 0) prevPriceRef.current = price

    return () => {
      if (timeout) clearTimeout(timeout)
    }
  }, [price])

  const getColor = () => {
    return direction === 'up' ? 'text-success' : 'text-danger'
  }

  return (
    <span
      className={cn(
        'text-lg font-bold transition-colors duration-200',
        getColor(),
        flash && (direction === 'up' ? 'price-flash-up' : 'price-flash-down'),
        className
      )}
    >
      {formatted}
    </span>
  )
}

