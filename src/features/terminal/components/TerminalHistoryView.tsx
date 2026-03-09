import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Calendar, History } from 'lucide-react'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { getPositions, type Position } from '../api/positions.api'
import { listOrders, type Order } from '../api/orders.api'
import { Skeleton } from '@/shared/ui'

type HistorySubTab = 'positions' | 'orders'

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

  const handleRefresh = () => {
    if (historySubTab === 'positions') fetchPositions()
    else fetchOrders()
    toast.success('Refreshed')
  }

  const closedPositions = positions
    .filter((p) => p.status === 'CLOSED' || p.status === 'LIQUIDATED')
    .sort((a, b) => {
      const aTime = a.closed_at ?? a.updated_at ?? 0
      const bTime = b.closed_at ?? b.updated_at ?? 0
      return (bTime < 1e12 ? bTime * 1000 : bTime) - (aTime < 1e12 ? aTime * 1000 : aTime)
    })

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
              onClick={() => toast('Search coming soon')}
              className="p-2 rounded-lg hover:bg-white/10 text-muted min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="p-2 rounded-lg hover:bg-white/10 text-muted min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Refresh"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => toast('Calendar filter coming soon')}
              className="p-2 rounded-lg hover:bg-white/10 text-muted min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Calendar"
            >
              <Calendar className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

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
          ) : closedPositions.length === 0 ? (
            <div className="text-center text-muted py-8">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No position history</p>
              <p className="text-xs mt-1">Closed positions will appear here</p>
            </div>
          ) : (
            <div className="space-y-0">
              {closedPositions.map((pos) => {
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
                          {realizedPnl >= 0 ? '+' : ''}{realizedPnl.toFixed(2)}
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
          ) : filledOrders.length === 0 ? (
            <div className="text-center text-muted py-8">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No order history</p>
              <p className="text-xs mt-1">Filled orders will appear here</p>
            </div>
          ) : (
            <div className="space-y-0">
              {filledOrders.map((order) => {
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
