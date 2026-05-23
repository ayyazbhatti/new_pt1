import { Fragment, memo, useMemo, type Dispatch, type MouseEvent, type MutableRefObject, type SetStateAction } from 'react'
import { ChevronDown, Edit, X } from 'lucide-react'
import { cn } from '@/shared/utils'
import { useSymbolPrice, normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import type { Position } from '../api/positions.api'
import {
  openPositionPnlParts,
  PositionPnLBreakdown,
} from '@/shared/components/PositionPnLBreakdown'
import { formatPositionSize } from '@/shared/finance/sizeFormat'
import { formatSymbolPrice } from '@/shared/finance/priceFormat'
import { getSymbolMetaForCode } from '../hooks/useSymbolMetaLookup'
import type { SymbolMeta } from '@/shared/finance/sizeFormat'
import type { CurrencyCode } from '@/shared/currency/types'

function livePriceFromTick(
  pos: Pick<Position, 'side'>,
  price: { bid: string; ask: string } | null,
): number | null {
  if (!price) return null
  return pos.side === 'LONG' ? parseFloat(price.bid) : parseFloat(price.ask)
}

export interface BottomDockDesktopOpenPositionRowProps {
  pos: Position
  index: number
  rowExpanded: boolean
  symbolMetaLookup: Map<string, SymbolMeta>
  posQuote: string
  formatConv: (value: number, quoteCurrency: string) => string
  formatSigned: (value: number, quoteCurrency: CurrencyCode) => string
  formatDateTimeSeconds: (tsMs: number) => string
  canClosePosition: boolean
  onRowClick: () => void
  onToggleExpand: (e: MouseEvent) => void
  onEditClick: (e: MouseEvent) => void
  onCloseClick: (e: MouseEvent) => void
}

export const BottomDockDesktopOpenPositionRow = memo(function BottomDockDesktopOpenPositionRow({
  pos,
  index,
  rowExpanded,
  symbolMetaLookup,
  posQuote,
  formatConv,
  formatSigned,
  formatDateTimeSeconds,
  canClosePosition,
  onRowClick,
  onToggleExpand,
  onEditClick,
  onCloseClick,
}: BottomDockDesktopOpenPositionRowProps) {
  const feedKey = normalizeSymbolKey(pos.symbol)
  const tick = useSymbolPrice(feedKey)
  const sizeNum = parseFloat(pos.size || '0')
  const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
  const marginNum = parseFloat(pos.margin || '0')
  const livePrice = livePriceFromTick(pos, tick)
  const { market: marketPnl, net: unrealizedPnl } = useMemo(
    () => openPositionPnlParts(pos, livePrice, sizeNum, entryPrice),
    [pos, livePrice, sizeNum, entryPrice],
  )

  const rowSymbolMeta = getSymbolMetaForCode(symbolMetaLookup, pos.symbol)
  const sizeDisplayFmt = formatPositionSize(sizeNum, rowSymbolMeta)

  const openedMs =
    pos.opened_at != null
      ? pos.opened_at < 1e12
        ? pos.opened_at * 1000
        : pos.opened_at
      : null
  const openedAtStr = openedMs != null ? formatDateTimeSeconds(openedMs) : '—'

  return (
    <Fragment>
      <tr
        onClick={onRowClick}
        className={cn(
          'border-b border-slate-200 dark:border-white/5 hover:bg-surface-2/40 transition-all duration-200 cursor-pointer',
          index % 2 === 0 ? 'bg-surface/30' : 'bg-surface/50',
        )}
      >
        <td className="px-4 py-3 font-mono text-text font-semibold">{pos.id.slice(0, 8)}...</td>
        <td className="px-4 py-3 font-mono font-bold text-text">{pos.symbol}</td>
        <td className="px-4 py-3 text-text font-medium" title={sizeDisplayFmt.secondary || undefined}>
          {sizeDisplayFmt.display}
        </td>
        <td className="px-4 py-3">
          <span
            className={cn(
              'px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider',
              pos.side === 'LONG' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger',
            )}
          >
            {pos.side}
          </span>
        </td>
        <td className="px-4 py-3 text-text font-semibold">
          {Number.isFinite(marginNum) ? formatConv(marginNum, posQuote as CurrencyCode) : '—'}
        </td>
        <td className="px-4 py-3 font-mono text-text font-medium">{formatSymbolPrice(entryPrice, rowSymbolMeta)}</td>
        <td className={cn('px-4 py-3 font-mono font-bold', livePrice !== null ? 'text-accent' : 'text-text/40')}>
          {livePrice !== null ? formatSymbolPrice(livePrice, rowSymbolMeta) : <span className="text-text/40">--</span>}
        </td>
        <td
          className={cn(
            'px-4 py-3 font-mono font-bold whitespace-nowrap tabular-nums',
            unrealizedPnl >= 0 ? 'text-success' : 'text-danger',
          )}
        >
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded hover:bg-surface-2 text-slate-600 dark:text-muted shrink-0"
              title={rowExpanded ? 'Hide P&L breakdown' : 'Show P&L breakdown'}
              aria-expanded={rowExpanded}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rowExpanded && 'rotate-180')} />
            </button>
            <span>{formatSigned(unrealizedPnl, posQuote as CurrencyCode)}</span>
          </div>
        </td>
        <td className="px-4 py-3 font-mono text-text/70">
          {pos.sl ? formatSymbolPrice(parseFloat(pos.sl), rowSymbolMeta) : '-'}
        </td>
        <td className="px-4 py-3 font-mono text-text/70">
          {pos.tp ? formatSymbolPrice(parseFloat(pos.tp), rowSymbolMeta) : '-'}
        </td>
        <td className="px-4 py-3 text-text/90 whitespace-nowrap tabular-nums" title={openedAtStr}>
          {openedAtStr}
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button
              onClick={onEditClick}
              className="p-2 hover:bg-accent/20 rounded-lg transition-all duration-200 text-accent hover:text-accent/80 hover:scale-110 active:scale-95"
              title="Edit Position"
            >
              <Edit className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onCloseClick}
              disabled={!canClosePosition}
              className="p-2 hover:bg-danger/20 rounded-lg transition-all duration-200 text-danger hover:text-danger/80 hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              title={!canClosePosition ? 'Trading is disabled' : 'Close Position'}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {rowExpanded ? (
        <tr
          className={cn(
            'border-b border-slate-200 dark:border-white/5',
            index % 2 === 0 ? 'bg-surface/30' : 'bg-surface/50',
          )}
        >
          <td colSpan={12} className="px-4 py-3 bg-surface-2/40">
            <div className="max-w-md">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-muted mb-2">
                P&L breakdown
              </div>
              <PositionPnLBreakdown
                marketPnlUsd={marketPnl}
                accumulatedSwapUsd={pos.accumulatedSwapUsd}
                accumulatedFeesUsd={pos.accumulatedFeesUsd}
                netPnlUsd={unrealizedPnl}
                quoteCurrency={posQuote}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
})

export interface BottomDockMobileOpenPositionCardProps {
  pos: Position
  posQuote: string
  symbolMetaLookup: Map<string, SymbolMeta>
  expandedPositionId: string | null
  setExpandedPositionId: Dispatch<SetStateAction<string | null>>
  formatDateTimeSeconds: (tsMs: number) => string
  formatConv: (value: number, quoteCurrency: string) => string
  formatSigned: (value: number, quoteCurrency: CurrencyCode) => string
  canClosePosition: boolean
  onOpenEdit: () => void
  onRequestClose: () => void
  setActionMenuPositionId: Dispatch<SetStateAction<string | null>>
  longPressHandledRef: MutableRefObject<boolean>
  longPressTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
}

export const BottomDockMobileOpenPositionCard = memo(function BottomDockMobileOpenPositionCard({
  pos,
  posQuote,
  symbolMetaLookup,
  expandedPositionId,
  setExpandedPositionId,
  formatDateTimeSeconds,
  formatConv,
  formatSigned,
  canClosePosition,
  onOpenEdit,
  onRequestClose,
  setActionMenuPositionId,
  longPressHandledRef,
  longPressTimerRef,
}: BottomDockMobileOpenPositionCardProps) {
  const feedKey = normalizeSymbolKey(pos.symbol)
  const tick = useSymbolPrice(feedKey)
  const sizeNum = parseFloat(pos.size || '0')
  const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
  const marginNum = parseFloat(pos.margin || '0')
  const livePrice = livePriceFromTick(pos, tick)
  const { market: marketPnl, net: unrealizedPnl } = useMemo(
    () => openPositionPnlParts(pos, livePrice, sizeNum, entryPrice),
    [pos, livePrice, sizeNum, entryPrice],
  )

  const rowSymbolMeta = getSymbolMetaForCode(symbolMetaLookup, pos.symbol)
  const sizeDisplayFmt = formatPositionSize(sizeNum, rowSymbolMeta)

  const ts = pos.opened_at != null ? (pos.opened_at < 1e12 ? pos.opened_at * 1000 : pos.opened_at) : Date.now()
  const openedAtStr = formatDateTimeSeconds(ts)
  const openedAtLongStr = formatDateTimeSeconds(ts)
  const currentStr = livePrice != null ? formatSymbolPrice(livePrice, rowSymbolMeta) : '—'
  const isExpanded = expandedPositionId === pos.id
  const hasValidSl = pos.sl != null && String(pos.sl).trim() !== '' && pos.sl !== 'null' && !Number.isNaN(Number(pos.sl))
  const hasValidTp = pos.tp != null && String(pos.tp).trim() !== '' && pos.tp !== 'null' && !Number.isNaN(Number(pos.tp))

  const handleRowClick = () => {
    if (longPressHandledRef.current) {
      longPressHandledRef.current = false
      return
    }
    setExpandedPositionId((prev) => (prev === pos.id ? null : pos.id))
  }

  const handleTouchStart = () => {
    longPressHandledRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      longPressHandledRef.current = true
      window.getSelection()?.removeAllRanges()
      setActionMenuPositionId(pos.id)
    }, 500)
  }

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    setActionMenuPositionId(pos.id)
  }

  return (
    <div className="border-b border-slate-300 dark:border-white/10 py-3 flex flex-col gap-1">
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => e.key === 'Enter' && handleRowClick()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        onContextMenu={handleContextMenu}
        className="flex items-start justify-between gap-3 cursor-pointer active:opacity-90 select-none [-webkit-touch-callout:none]"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text">
            <span className="font-mono">{pos.symbol}</span>
            <span className="font-bold text-text ml-1">{pos.side === 'LONG' ? 'Buy' : 'Sell'}</span>
            <span className="font-bold text-text ml-1" title={sizeDisplayFmt.secondary || undefined}>
              {sizeDisplayFmt.display}
            </span>
          </div>
          <div className="text-xs text-slate-600 dark:text-muted font-mono mt-0.5">
            {formatSymbolPrice(entryPrice, rowSymbolMeta)} → {currentStr}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-slate-600 dark:text-muted">{openedAtStr}</div>
          <div
            className={cn(
              'text-sm font-semibold whitespace-nowrap tabular-nums',
              unrealizedPnl >= 0 ? 'text-success' : 'text-danger',
            )}
          >
            {formatSigned(unrealizedPnl, posQuote as CurrencyCode)}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div
          className="pt-3 pb-2 space-y-2 border-t border-slate-200 dark:border-white/5 mt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <div className="text-xs font-semibold text-slate-600 dark:text-muted mb-1">P&L breakdown</div>
            <PositionPnLBreakdown
              marketPnlUsd={marketPnl}
              accumulatedSwapUsd={pos.accumulatedSwapUsd}
              accumulatedFeesUsd={pos.accumulatedFeesUsd}
              netPnlUsd={unrealizedPnl}
              quoteCurrency={posQuote}
            />
          </div>
          <div className="text-xs text-slate-600 dark:text-muted font-mono">
            {formatSymbolPrice(entryPrice, rowSymbolMeta)} →{' '}
            {livePrice != null ? formatSymbolPrice(livePrice, rowSymbolMeta) : '—'}
          </div>
          <div className="text-xs text-slate-600 dark:text-muted">{openedAtLongStr}</div>
          <div className="flex justify-between gap-4 text-xs">
            <div className="space-y-1 text-slate-600 dark:text-muted">
              {hasValidSl && <div>S/L {formatSymbolPrice(Number(pos.sl), rowSymbolMeta)}</div>}
              <div>
                Margin{' '}
                {Number.isFinite(marginNum) ? formatConv(marginNum, posQuote as CurrencyCode) : '—'}
              </div>
            </div>
            <div className="space-y-1 text-slate-600 dark:text-muted text-right">
              {hasValidTp && <div>T/P {formatSymbolPrice(Number(pos.tp), rowSymbolMeta)}</div>}
              <div className="font-mono">PID {pos.id.slice(0, 8)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onOpenEdit}
              className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-accent/20 text-accent font-semibold text-xs"
            >
              <Edit className="h-4 w-4" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                if (!canClosePosition) return
                onRequestClose()
              }}
              disabled={!canClosePosition}
              className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-danger/20 text-danger font-semibold text-xs disabled:opacity-50 disabled:pointer-events-none"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
