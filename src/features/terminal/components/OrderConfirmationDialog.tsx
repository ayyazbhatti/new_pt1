import * as Dialog from '@radix-ui/react-dialog'
import { useMemo } from 'react'
import type { AdminSymbol } from '@/features/symbols/types/symbol'
import { formatLotSize, formatUnits } from '@/features/terminal/utils/positionCalculations'
import { formatAmount, convertAmount } from '@/shared/currency/format'
import type { CurrencyCode } from '@/shared/currency/types'
import { useFxRatesMap } from '@/shared/currency/rates'
import { useFormatFromUsd } from '@/shared/currency'
import type { PlaceOrderRequest } from '../api/orders.api'

export interface OrderConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  /** Canonical order payload (size in base units as string). */
  payload: PlaceOrderRequest | null
  side: 'BUY' | 'SELL'
  orderType: 'market' | 'limit'
  baseSize: number
  /** Single-line summary of what the user typed (e.g. `500 CAD`, `0.01 lots`). */
  youEnteredLabel: string
  symbolForCalc: AdminSymbol
  symbolCode: string
  baseCurrency: string
  quoteCurrency: string
  liveBid: number | null
  liveAsk: number | null
  estimatedMarginUsd: number | null
  estimatedFeeUsd: number | null
  isSubmitting: boolean
}

export function OrderConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  payload,
  side,
  orderType,
  baseSize,
  youEnteredLabel,
  symbolForCalc,
  symbolCode,
  baseCurrency,
  quoteCurrency,
  liveBid,
  liveAsk,
  estimatedMarginUsd,
  estimatedFeeUsd,
  isSubmitting,
}: OrderConfirmationDialogProps) {
  const rates = useFxRatesMap()
  const formatMoney = useFormatFromUsd()

  const pricePrecision = symbolForCalc.pricePrecision ?? 5

  const execQuote = useMemo(() => {
    if (orderType === 'limit' && payload?.limit_price) {
      const n = parseFloat(payload.limit_price)
      return Number.isFinite(n) && n > 0 ? n : null
    }
    if (side === 'BUY') {
      return liveAsk != null && liveAsk > 0 ? liveAsk : null
    }
    return liveBid != null && liveBid > 0 ? liveBid : null
  }, [orderType, payload?.limit_price, side, liveAsk, liveBid])

  const notionalQuote = useMemo(() => {
    if (!execQuote || !Number.isFinite(baseSize) || baseSize <= 0) return null
    return baseSize * execQuote
  }, [baseSize, execQuote])

  const notionalUsd = useMemo(() => {
    if (notionalQuote == null) return null
    const v = convertAmount(notionalQuote, quoteCurrency as CurrencyCode, 'USD', rates)
    return v
  }, [notionalQuote, quoteCurrency, rates])

  const lots = useMemo(() => {
    const cs = parseFloat(String(symbolForCalc.contractSize ?? '1')) || 1
    if (cs <= 0) return null
    return baseSize / cs
  }, [baseSize, symbolForCalc.contractSize])

  const notionalUsdDisplay =
    notionalUsd != null && Number.isFinite(notionalUsd) ? formatAmount(notionalUsd, 'USD') : '—'

  const notionalQuoteDisplay =
    notionalQuote != null && Number.isFinite(notionalQuote)
      ? formatAmount(notionalQuote, quoteCurrency as CurrencyCode)
      : '—'

  const bidAskDisplay =
    liveBid != null &&
    liveAsk != null &&
    liveBid > 0 &&
    liveAsk > 0 &&
    Number.isFinite(liveBid) &&
    Number.isFinite(liveAsk)
      ? `${liveBid.toFixed(pricePrecision)} / ${liveAsk.toFixed(pricePrecision)}`
      : '—'

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 dark:bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-lg">
          <Dialog.Title className="text-lg font-semibold text-text mb-2">
            Confirm {side} {orderType === 'limit' ? 'limit' : 'market'} order
          </Dialog.Title>
          <Dialog.Description className="text-sm text-slate-600 dark:text-muted mb-4">
            Review size, notional, and costs before placing. ({symbolCode})
          </Dialog.Description>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-slate-600 dark:text-muted">Direction</span>
              <span className={side === 'BUY' ? 'font-semibold text-success' : 'font-semibold text-danger'}>
                {side}
              </span>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-muted">
                Size
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-600 dark:text-muted">You entered</span>
                <span className="font-mono text-right text-text">{youEnteredLabel}</span>
              </div>
              {lots != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-600 dark:text-muted">Lots</span>
                  <span className="font-mono text-text">{formatLotSize(lots, symbolForCalc)} lots</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-slate-600 dark:text-muted">Units ({baseCurrency})</span>
                <span className="font-mono text-text">{formatUnits(baseSize, symbolForCalc)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-600 dark:text-muted">Notional ({quoteCurrency})</span>
                <span className="font-mono text-text">{notionalQuoteDisplay}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-600 dark:text-muted">Notional (USD)</span>
                <span className="font-mono text-text">{notionalUsdDisplay}</span>
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-muted">
                Price
              </div>
              {orderType === 'limit' && payload?.limit_price ? (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-600 dark:text-muted">Limit price</span>
                  <span className="font-mono text-text">{payload.limit_price}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-600 dark:text-muted">Bid / Ask</span>
                    <span className="font-mono text-text">{bidAskDisplay}</span>
                  </div>
                  {payload?.slippage_bps != null && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-600 dark:text-muted">Slippage tolerance</span>
                      <span className="font-mono text-text">{payload.slippage_bps} bps</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {(payload?.sl || payload?.tp) && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-muted">
                  Risk
                </div>
                {payload.sl ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-600 dark:text-muted">Stop loss</span>
                    <span className="font-mono text-text">{payload.sl}</span>
                  </div>
                ) : null}
                {payload.tp ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-600 dark:text-muted">Take profit</span>
                    <span className="font-mono text-text">{payload.tp}</span>
                  </div>
                ) : null}
              </div>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-muted">
                Cost
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-600 dark:text-muted">Est. margin</span>
                <span className="font-mono font-semibold text-text">
                  {estimatedMarginUsd != null && Number.isFinite(estimatedMarginUsd)
                    ? formatMoney(estimatedMarginUsd)
                    : '—'}
                </span>
              </div>
              {estimatedFeeUsd != null && estimatedFeeUsd > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-600 dark:text-muted">Est. fee</span>
                  <span className="font-mono text-text">{formatMoney(estimatedFeeUsd)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="flex-1 py-2 px-4 rounded-lg border border-border bg-surface-2 hover:bg-surface text-text text-sm font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                side === 'BUY' ? 'bg-success hover:bg-success/90' : 'bg-danger hover:bg-danger/90'
              }`}
            >
              {isSubmitting ? 'Placing…' : `Confirm ${side}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
