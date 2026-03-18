import { useState, useEffect, useCallback } from 'react'
import { format, parse } from 'date-fns'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { Search, Calendar, History, X } from 'lucide-react'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { getPositions, type Position } from '../api/positions.api'
import { listOrders, type Order } from '../api/orders.api'
import { Skeleton, Input } from '@/shared/ui'

type HistorySubTab = 'positions' | 'orders'

/** Timestamp (ms or sec) to YYYY-MM-DD for date range comparison */
function toDateString(ts: number): string {
  const ms = ts < 1e12 ? ts * 1000 : ts
  return format(new Date(ms), 'yyyy-MM-dd')
}

/**
 * Mobile History tab: Position History and Order History sub-tabs with account summary.
 * Matches reference layout: header with title/subtitle and icons, two sub-tabs, summary, then list.
 */
export function TerminalHistoryView() {
  const [historySubTab, setHistorySubTab] = useState<HistorySubTab>('positions')
  const [positions, setPositions] = useState<Position[]>([])
  const [filledOrders, setFilledOrders] = useState<Order[]>([])
  const [loadingPositions, setLoadingPositions] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const { accountSummary } = useAccountSummary()

  const fetchPositions = useCallback(async () => {
    setLoadingPositions(true)
    try {
      const data = await getPositions()
      setPositions(data)
    } catch (e) {
      console.error('Failed to fetch positions for history:', e)
      toast.error('Failed to load position history')
    } finally {
      setLoadingPositions(false)
    }
  }, [])

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const data = await listOrders({ status: 'filled', limit: 100 })
      setFilledOrders(data.items)
    } catch (e) {
      console.error('Failed to fetch orders for history:', e)
      toast.error('Failed to load order history')
    } finally {
      setLoadingOrders(false)
    }
  }, [])

  useEffect(() => {
    fetchPositions()
    fetchOrders()
  }, [fetchPositions, fetchOrders])

  const closedPositions = positions
    .filter((p) => p.status === 'CLOSED' || p.status === 'LIQUIDATED')
    .sort((a, b) => {
      const aTime = a.closed_at ?? a.updated_at ?? 0
      const bTime = b.closed_at ?? b.updated_at ?? 0
      return (bTime < 1e12 ? bTime * 1000 : bTime) - (aTime < 1e12 ? aTime * 1000 : aTime)
    })

  const q = searchQuery.trim().toLowerCase()
  const searchFilteredClosed = q
    ? closedPositions.filter(
        (p) =>
          (p.symbol && p.symbol.toLowerCase().includes(q)) ||
          (p.side && p.side.toLowerCase().includes(q))
      )
    : closedPositions
  const searchFilteredOrders = q
    ? filledOrders.filter(
        (o) =>
          (o.symbol && o.symbol.toLowerCase().includes(q)) ||
          (o.side && o.side.toLowerCase().includes(q)) ||
          (o.order_type && o.order_type.toLowerCase().includes(q))
      )
    : filledOrders

  const hasDateFilter = dateFrom !== '' || dateTo !== ''
  const filteredClosedPositions = hasDateFilter
    ? searchFilteredClosed.filter((p) => {
        const ts = p.closed_at ?? p.updated_at ?? 0
        const d = toDateString(ts)
        if (dateFrom && d < dateFrom) return false
        if (dateTo && d > dateTo) return false
        return true
      })
    : searchFilteredClosed
  const filteredFilledOrders = hasDateFilter
    ? searchFilteredOrders.filter((o) => {
        const ts = new Date(o.created_at).getTime()
        const d = toDateString(ts)
        if (dateFrom && d < dateFrom) return false
        if (dateTo && d > dateTo) return false
        return true
      })
    : searchFilteredOrders

  const lastTenClosed = closedPositions.length
  const lastTenOrders = Math.min(filledOrders.length, 10)

  const summaryRows =
    historySubTab === 'positions'
      ? [
          { label: 'Last Ten Closed:', value: String(lastTenClosed) },
          { label: 'Balance:', value: accountSummary != null ? `$${accountSummary.balance.toFixed(2)}` : '—' },
          {
            label: 'Profit:',
            value: accountSummary != null ? `$${accountSummary.realizedPnl.toFixed(2)}` : '—',
            valueClass: accountSummary != null && accountSummary.realizedPnl < 0 ? 'text-danger' : 'text-success',
          },
          { label: 'Equity:', value: accountSummary != null ? `$${accountSummary.equity.toFixed(2)}` : '—' },
          {
            label: 'Free Margin:',
            value: accountSummary != null ? `$${accountSummary.freeMargin.toFixed(2)}` : '—',
            valueClass: accountSummary != null && accountSummary.freeMargin < 0 ? 'text-danger' : undefined,
          },
        ]
      : [
          { label: 'Last Ten Closed:', value: String(lastTenOrders) },
          { label: 'Balance:', value: accountSummary != null ? `$${accountSummary.balance.toFixed(2)}` : '—' },
          {
            label: 'Profit:',
            value: accountSummary != null ? `$${accountSummary.realizedPnl.toFixed(2)}` : '—',
            valueClass: accountSummary != null && accountSummary.realizedPnl < 0 ? 'text-danger' : 'text-success',
          },
          { label: 'Equity:', value: accountSummary != null ? `$${accountSummary.equity.toFixed(2)}` : '—' },
          {
            label: 'Free Margin:',
            value: accountSummary != null ? `$${accountSummary.freeMargin.toFixed(2)}` : '—',
            valueClass: accountSummary != null && accountSummary.freeMargin < 0 ? 'text-danger' : undefined,
          },
        ]

  const subtitle = historySubTab === 'positions' ? 'Last 10 positions' : 'Last 10 orders'

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-text">History</h1>
            <p className="text-xs text-accent mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen((open) => !open)}
              className={cn(
                'p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center',
                searchOpen ? 'bg-white/10 text-accent' : 'hover:bg-white/10 text-muted'
              )}
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setCalendarOpen((open) => !open)}
              className={cn(
                'p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center',
                calendarOpen || hasDateFilter ? 'bg-white/10 text-accent' : 'hover:bg-white/10 text-muted'
              )}
              aria-label="Date range filter"
            >
              <Calendar className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Date range filter (when Calendar icon is active) */}
      {calendarOpen && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-surface/50">
          <label className="text-xs text-muted shrink-0 w-10">From</label>
          <DatePicker
            selected={dateFrom ? parse(dateFrom, 'yyyy-MM-dd', new Date()) : null}
            onChange={(d) => setDateFrom(d ? format(d, 'yyyy-MM-dd') : '')}
            dateFormat="dd-MMM-yyyy"
            placeholderText="From"
            className="flex-1 min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent h-10 w-full"
            calendarClassName="react-datepicker--dark"
            aria-label="From date"
          />
          <span className="text-xs text-muted shrink-0">To</span>
          <DatePicker
            selected={dateTo ? parse(dateTo, 'yyyy-MM-dd', new Date()) : null}
            onChange={(d) => setDateTo(d ? format(d, 'yyyy-MM-dd') : '')}
            dateFormat="dd-MMM-yyyy"
            placeholderText="To"
            className="flex-1 min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent h-10 w-full"
            calendarClassName="react-datepicker--dark"
            aria-label="To date"
          />
          <button
            type="button"
            onClick={() => {
              setDateFrom('')
              setDateTo('')
              setCalendarOpen(false)
            }}
            className="shrink-0 px-3 py-2 text-xs font-medium text-muted hover:text-text hover:bg-white/10 rounded-lg transition-colors h-10"
          >
            Clear dates
          </button>
        </div>
      )}

      {/* Search bar (when Search icon is active) */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-surface/50">
          <Search className="h-4 w-4 text-muted shrink-0" />
          <Input
            type="text"
            placeholder="Symbol, side (e.g. BTC, long)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-0 bg-background border-border text-sm"
            autoFocus
            aria-label="Search history"
          />
          <button
            type="button"
            onClick={() => {
              setSearchQuery('')
              setSearchOpen(false)
            }}
            className="p-2 rounded-lg hover:bg-white/10 text-muted shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Clear search"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Sub-tabs: POSITIONS | ORDERS */}
      <div className="shrink-0 flex border-b border-white/5">
        {(['positions', 'orders'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setHistorySubTab(tab)}
            className={cn(
              'flex-1 py-3 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px',
              historySubTab === tab
                ? 'text-white border-accent'
                : 'text-muted border-transparent hover:text-text'
            )}
          >
            {tab === 'positions' ? 'Positions' : 'Orders'}
          </button>
        ))}
      </div>

      {/* Account summary */}
      <section className="shrink-0 py-3 px-4 space-y-2">
        {summaryRows.map(({ label, value, valueClass }) => (
          <div key={label} className="flex justify-between items-center text-sm">
            <span className="text-muted">{label}</span>
            <span className={cn('font-medium text-text', valueClass)}>{value}</span>
          </div>
        ))}
      </section>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-4">
        {historySubTab === 'positions' ? (
          loadingPositions ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" variant="text" />
              ))}
            </div>
          ) : filteredClosedPositions.length === 0 ? (
            <div className="text-center text-muted py-8">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">
                {searchQuery.trim()
                  ? 'No matching positions'
                  : hasDateFilter
                    ? 'No positions in this date range'
                    : 'No position history'}
              </p>
              <p className="text-xs mt-1">
                {searchQuery.trim()
                  ? 'Try a different search'
                  : hasDateFilter
                    ? 'Change or clear the date filter'
                    : 'Closed positions will appear here'}
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {filteredClosedPositions.map((pos) => {
                const sizeVal = (pos.status === 'CLOSED' || pos.status === 'LIQUIDATED') && pos.original_size ? pos.original_size : pos.size
                const sizeNum = parseFloat(sizeVal || '0')
                const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
                const exitVal = pos.exit_price ?? (pos as { exitPrice?: string }).exitPrice ?? ''
                const exitPrice = exitVal && exitVal !== 'null' ? parseFloat(String(exitVal)) : null
                const realizedPnl = parseFloat(pos.realized_pnl || '0')
                const ts = pos.closed_at ?? pos.updated_at ?? 0
                const tsMs = ts < 1e12 ? ts * 1000 : ts
                const closedAtStr = new Date(tsMs).toLocaleString(undefined, {
                  month: 'numeric',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })
                return (
                  <div key={pos.id} className="border-b border-white/10 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text">
                          <span className="font-mono">{pos.symbol}</span>
                          <span className="ml-1 font-bold">{pos.side === 'LONG' ? 'Buy' : 'Sell'}</span>
                          <span className="ml-1 font-bold">{sizeNum.toFixed(4)}</span>
                        </div>
                        <div className="text-xs text-muted font-mono mt-0.5">
                          {entryPrice.toFixed(5)} → {exitPrice != null ? exitPrice.toFixed(5) : '—'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-muted">{closedAtStr}</div>
                        <div className={cn('text-sm font-semibold', realizedPnl >= 0 ? 'text-success' : 'text-danger')}>
                          {realizedPnl >= 0 ? '+' : ''}{realizedPnl.toFixed(4)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="text-center text-muted text-xs py-3">No more data</div>
            </div>
          )
        ) : (
          loadingOrders ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" variant="text" />
              ))}
            </div>
          ) : filteredFilledOrders.length === 0 ? (
            <div className="text-center text-muted py-8">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">
                {searchQuery.trim()
                  ? 'No matching orders'
                  : hasDateFilter
                    ? 'No orders in this date range'
                    : 'No order history'}
              </p>
              <p className="text-xs mt-1">
                {searchQuery.trim()
                  ? 'Try a different search'
                  : hasDateFilter
                    ? 'Change or clear the date filter'
                    : 'Filled orders will appear here'}
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {filteredFilledOrders.map((order) => {
                const filledSize = parseFloat(order.filled_size || order.size || '0')
                const avgPrice = parseFloat(order.average_price || order.price || '0')
                const createdStr = new Date(order.created_at).toLocaleString(undefined, {
                  month: 'numeric',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })
                return (
                  <div key={order.id} className="border-b border-white/10 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text">
                          <span className="font-mono">{order.symbol}</span>
                          <span className="ml-1 font-bold">{order.side === 'BUY' ? 'Buy' : 'Sell'}</span>
                          <span className="ml-1 font-bold">{filledSize.toFixed(4)}</span>
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          {order.order_type} @ {avgPrice > 0 ? `$${avgPrice.toFixed(2)}` : '—'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-muted">{createdStr}</div>
                        <span className="text-xs px-2 py-0.5 rounded bg-success/20 text-success font-semibold uppercase">
                          {order.status}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="text-center text-muted text-xs py-3">No more data</div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
