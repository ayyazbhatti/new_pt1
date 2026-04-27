import { useState, useCallback, useMemo } from 'react'
import { TrendingUp, TrendingDown, Loader2, Minus, Plus } from 'lucide-react'
import { Button, Input } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useTerminalStore } from '../store'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWebSocketState } from '@/shared/ws/wsHooks'
import { toast } from '@/shared/components/common'
import { placeOrder } from '../api/orders.api'
import { me, getSymbolLeverage, getEffectiveLeverage } from '@/shared/api/auth.api'

/**
 * Compact Buy/Sell strip for the Chart tab: size input + Est. Margin + Buy + Sell (MARKET orders).
 * Reuses same placeOrder API and Est. Margin calculation as the Trade panel.
 */
export function ChartTradingStrip() {
  const { selectedSymbol } = useTerminalStore()
  const { accountSummary } = useAccountSummary()
  const tradingAccess = useAuthStore((s) => s.user?.tradingAccess ?? 'full')
  const wsState = useWebSocketState()

  const { data: meData } = useQuery({ queryKey: ['auth', 'me'], queryFn: me })
  const { data: symbolLeverage } = useQuery({
    queryKey: ['auth', 'symbolLeverage', selectedSymbol?.code],
    queryFn: () => getSymbolLeverage(selectedSymbol!.code),
    enabled: !!selectedSymbol?.code,
  })

  const [size, setSize] = useState('0.01')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const canPlaceOrder = tradingAccess !== 'disabled'
  const wsConnected = wsState === 'authenticated'
  const bid = selectedSymbol?.numericPrice ?? 0
  const ask = selectedSymbol?.numericPrice2 ?? bid
  const refPrice = ask !== bid ? (bid + ask) / 2 : bid
  const sizeNum = parseFloat(size) || 0
  const quoteValue = sizeNum * refPrice
  const freeMargin = accountSummary?.freeMargin ?? 0

  // Est. Margin: same logic as Trade panel (notional × mid, leverage from tiers)
  const estMargin = useMemo(() => {
    if (!selectedSymbol || quoteValue <= 0) return 0
    const effectiveLeverage = getEffectiveLeverage(
      quoteValue,
      symbolLeverage?.tiers ?? null,
      meData?.minLeverage,
      meData?.maxLeverage,
      50
    )
    return effectiveLeverage > 0 ? quoteValue / effectiveLeverage : quoteValue * 0.02
  }, [selectedSymbol, quoteValue, symbolLeverage?.tiers, meData?.minLeverage, meData?.maxLeverage])

  const estMarginFormatted = selectedSymbol && (sizeNum > 0 || estMargin > 0)
    ? `$${estMargin.toFixed(2)}`
    : '$0.00'

  const insufficientFreeMargin = estMargin > 0 && estMargin > freeMargin

  const step = 0.01
  const minSize = 0.001
  const adjustSize = useCallback(
    (delta: number) => {
      const next = Math.max(minSize, sizeNum + delta)
      const formatted = next >= 1 ? next.toFixed(2) : next.toFixed(Math.max(2, (step.toString().split('.')[1]?.length ?? 2)))
      setSize(formatted)
    },
    [sizeNum]
  )

  const handlePlaceOrder = async (side: 'BUY' | 'SELL') => {
    if (!selectedSymbol || !canPlaceOrder) {
      toast.error(tradingAccess === 'close_only' ? 'Opening new positions is disabled' : 'Trading is disabled')
      return
    }
    if (sizeNum <= 0) {
      toast.error('Enter a valid size')
      return
    }
    if (insufficientFreeMargin) {
      toast.error(
        `Insufficient funds: required margin $${estMargin.toFixed(2)}, free margin $${freeMargin.toFixed(2)}`
      )
      return
    }
    setIsSubmitting(true)
    try {
      const payload = {
        symbol: selectedSymbol.code,
        side,
        order_type: 'MARKET' as const,
        size: sizeNum.toString(),
        idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      }
      const res = await placeOrder(payload)
      toast.success(
        `${side} order submitted: ${size} @ ${selectedSymbol.code}${res.orderId ? ` (${res.orderId.slice(0, 8)}…)` : ''}`,
        { duration: 3000 }
      )
      setSize('0.01')
    } catch (err: unknown) {
      const e = err as {
        response?: {
          data?: {
            error?: string | { code?: string; message?: string }
            message?: string
            required_margin?: string
            free_margin?: string
          }
        }
        message?: string
      }
      const data = e?.response?.data
      const insufficientCode =
        data?.error === 'INSUFFICIENT_FREE_MARGIN' ||
        (typeof data?.error === 'object' && data?.error?.code === 'INSUFFICIENT_FREE_MARGIN')
      const required = Number(data?.required_margin)
      const free = Number(data?.free_margin)
      const msg = insufficientCode
        ? (Number.isFinite(required) && Number.isFinite(free)
          ? `Insufficient funds: required margin $${required.toFixed(2)}, free margin $${free.toFixed(2)}`
          : 'Insufficient funds/margin to place this order')
        : (typeof data?.error === 'object' && data?.error?.message) || data?.message || (e?.message ?? 'Failed to place order')
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="shrink-0 flex flex-col gap-2 px-3 py-2 border-t border-white/5 bg-surface-2/50">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted shrink-0 font-medium">Size</label>
        <div className="flex-1 min-w-0 flex items-stretch rounded-md border border-border bg-background overflow-hidden">
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="0.01"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="h-9 text-sm border-0 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 min-w-0 w-0"
            disabled={!selectedSymbol}
          />
          <div className="flex flex-row shrink-0 h-9">
            <button
              type="button"
              aria-label="Decrease size"
              onClick={() => adjustSize(-step)}
              disabled={!selectedSymbol || sizeNum <= minSize}
              className="w-9 h-full flex items-center justify-center text-muted hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Increase size"
              onClick={() => adjustSize(step)}
              disabled={!selectedSymbol}
              className="w-9 h-full flex items-center justify-center text-muted hover:text-foreground hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none touch-manipulation border-l border-border"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <Input
          type="text"
          readOnly
          value={estMarginFormatted}
          className="h-9 w-20 shrink-0 text-sm text-right bg-surface-2/80 border border-border rounded-md text-text cursor-default"
          tabIndex={-1}
          aria-label="Estimated margin"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="success"
          size="sm"
          className="flex-1 min-w-0 h-11 font-semibold text-sm"
          onClick={() => handlePlaceOrder('BUY')}
          disabled={isSubmitting || !selectedSymbol || !wsConnected || insufficientFreeMargin || !canPlaceOrder}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          <span className="ml-1">Buy</span>
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="flex-1 min-w-0 h-11 font-semibold text-sm"
          onClick={() => handlePlaceOrder('SELL')}
          disabled={isSubmitting || !selectedSymbol || !wsConnected || insufficientFreeMargin || !canPlaceOrder}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingDown className="h-4 w-4" />}
          <span className="ml-1">Sell</span>
        </Button>
      </div>
    </div>
  )
}
