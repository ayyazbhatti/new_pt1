import { useState, useCallback, useMemo } from 'react'
import { TrendingUp, TrendingDown, Loader2, Minus, Plus } from 'lucide-react'
import { Button, Input } from '@/shared/ui'
import { useQuery } from '@tanstack/react-query'
import { useTerminalStore } from '../store'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWebSocketState } from '@/shared/ws/wsHooks'
import { toast } from '@/shared/components/common'
import { placeOrder, estimateOrderMargin, clientMarketFallbackMarginUsdOrNull } from '../api/orders.api'
import { me, getSymbolLeverage } from '@/shared/api/auth.api'

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
  const [previewOrderSide, setPreviewOrderSide] = useState<'BUY' | 'SELL'>('BUY')

  const canPlaceOrder = tradingAccess !== 'disabled'
  const wsConnected = wsState === 'authenticated'
  const bid = selectedSymbol?.numericPrice ?? 0
  const ask = selectedSymbol?.numericPrice2 ?? bid
  const sizeNum = parseFloat(size) || 0
  const freeMargin = accountSummary?.freeMargin ?? 0

  const canEstimateServerMargin =
    !!selectedSymbol && Number.isFinite(sizeNum) && sizeNum > 0

  const { data: serverMarginEstimate } = useQuery({
    queryKey: ['v1', 'orderMarginEstimate', 'chartStrip', selectedSymbol?.code, sizeNum, previewOrderSide],
    queryFn: () =>
      estimateOrderMargin({
        symbol: selectedSymbol!.code,
        side: previewOrderSide,
        orderType: 'MARKET',
        size: String(sizeNum),
      }),
    enabled: canEstimateServerMargin,
    staleTime: 2000,
  })

  const parsedServerMarginUsd = useMemo(() => {
    const s = serverMarginEstimate?.requiredMargin
    if (s == null || s === '') return null
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }, [serverMarginEstimate?.requiredMargin])

  const fallbackMarginUsd = useMemo(() => {
    if (!selectedSymbol) return null
    return clientMarketFallbackMarginUsdOrNull({
      bid,
      ask,
      side: previewOrderSide,
      baseUnits: sizeNum,
      tiers: symbolLeverage?.tiers,
      userMin: meData?.minLeverage,
      userMax: meData?.maxLeverage,
    })
  }, [selectedSymbol, bid, ask, previewOrderSide, sizeNum, symbolLeverage?.tiers, meData?.minLeverage, meData?.maxLeverage])

  const estMarginUsd: number | null = parsedServerMarginUsd != null ? parsedServerMarginUsd : fallbackMarginUsd
  const marginCalcUnavailable = canEstimateServerMargin && estMarginUsd == null

  const estMarginFormatted = useMemo(() => {
    if (!selectedSymbol) return '$0.00'
    if (sizeNum <= 0) return '$0.00'
    if (estMarginUsd == null) return '—'
    return `$${estMarginUsd.toFixed(2)}`
  }, [selectedSymbol, sizeNum, estMarginUsd])

  const insufficientFreeMargin = estMarginUsd != null && estMarginUsd > freeMargin

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
    if (canEstimateServerMargin && estMarginUsd == null) {
      toast.error(
        'Margin cannot be calculated — tier configuration unavailable or price data missing. Check Admin leverage profiles for this symbol.'
      )
      return
    }
    if (insufficientFreeMargin && estMarginUsd != null) {
      toast.error(
        `Insufficient funds: required margin $${estMarginUsd.toFixed(2)}, free margin $${freeMargin.toFixed(2)}`
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
    <div className="shrink-0 flex flex-col gap-2 px-3 py-2 border-t border-slate-200 dark:border-white/5 bg-surface-2/50">
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
              className="w-9 h-full flex items-center justify-center text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text hover:bg-slate-200/80 dark:hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Increase size"
              onClick={() => adjustSize(step)}
              disabled={!selectedSymbol}
              className="w-9 h-full flex items-center justify-center text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text hover:bg-slate-200/80 dark:hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none touch-manipulation border-l border-border"
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
          onClick={() => {
            setPreviewOrderSide('BUY')
            void handlePlaceOrder('BUY')
          }}
          onMouseEnter={() => setPreviewOrderSide('BUY')}
          onFocus={() => setPreviewOrderSide('BUY')}
          title={
            marginCalcUnavailable
              ? 'Margin cannot be calculated — tier configuration unavailable.'
              : undefined
          }
          disabled={
            isSubmitting ||
            !selectedSymbol ||
            !wsConnected ||
            marginCalcUnavailable ||
            insufficientFreeMargin ||
            !canPlaceOrder
          }
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          <span className="ml-1">Buy</span>
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="flex-1 min-w-0 h-11 font-semibold text-sm"
          onClick={() => {
            setPreviewOrderSide('SELL')
            void handlePlaceOrder('SELL')
          }}
          onMouseEnter={() => setPreviewOrderSide('SELL')}
          onFocus={() => setPreviewOrderSide('SELL')}
          title={
            marginCalcUnavailable
              ? 'Margin cannot be calculated — tier configuration unavailable.'
              : undefined
          }
          disabled={
            isSubmitting ||
            !selectedSymbol ||
            !wsConnected ||
            marginCalcUnavailable ||
            insufficientFreeMargin ||
            !canPlaceOrder
          }
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingDown className="h-4 w-4" />}
          <span className="ml-1">Sell</span>
        </Button>
      </div>
    </div>
  )
}
