import { useEffect, useMemo, useCallback } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useCanAccess } from '@/shared/utils/permissions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { Plus, LayoutList, DollarSign, TrendingUp, ClipboardList } from 'lucide-react'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { fetchAdminOrders } from '../api/orders'
import { fetchAdminPositions } from '../api/positions'
import { TradingFiltersBar } from '../components/TradingFiltersBar'
import { OrdersTable } from '../components/OrdersTable'
import { PositionsTable } from '../components/PositionsTable'
import { OrderCreateModal } from '../components/OrderCreateModal'
import { OrderDetailsModal } from '../components/OrderDetailsModal'
import { PositionDetailsModal } from '../components/PositionDetailsModal'
import { ClosePositionModal } from '../components/ClosePositionModal'
import { ModifySltpModal } from '../components/ModifySltpModal'
import { useAdminWebSocket } from '../hooks/useAdminWebSocket'
import { useAdminTradingLivePrices } from '../hooks/useAdminTradingLivePrices'
import { computePositionPnl } from '../utils/pnl'
import { useDebouncedCallback } from '@/shared/hooks/useDebounce'
import { toast } from '@/shared/components/common'

export function AdminTradingPage() {
  const canCreateOrder = useCanAccess('trading:create_order')
  const {
    filters,
    activeTab,
    setActiveTab,
    orders,
    positions,
    ordersLoading,
    positionsLoading,
    setOrders,
    setPositions,
    setOrdersLoading,
    setPositionsLoading,
    getOrdersArray,
    getPositionsArray,
    setOpenModal,
    liveMarkBySymbol,
  } = useAdminTradingStore()

  // WebSocket integration
  useAdminWebSocket()

  // Fetch orders
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const response = await fetchAdminOrders(filters)
      setOrders(response.items || [], response.cursor, response.hasMore)
    } catch (error: any) {
      // Handle 404 gracefully - endpoint not implemented yet
      if (error?.response?.status === 404) {
        // Only log in development
        if (import.meta.env.DEV) {
          console.debug('Orders endpoint not available yet (404). Backend implementation pending.')
        }
        setOrders([], undefined, false)
      } else {
        console.error('Failed to fetch orders:', error)
      }
    } finally {
      setOrdersLoading(false)
    }
  }, [filters, setOrders, setOrdersLoading])

  // Fetch positions
  const loadPositions = useCallback(async () => {
    setPositionsLoading(true)
    try {
      const response = await fetchAdminPositions(filters)
      const items = response?.items ?? []
      setPositions(items, response?.cursor, response?.hasMore ?? false)
    } catch (error: any) {
      console.error('Failed to fetch positions:', error)
      setPositions([], undefined, false)
      if (error?.response?.status !== 404) {
        toast.error(error?.response?.data?.error?.message || error?.message || 'Failed to load positions')
      }
    } finally {
      setPositionsLoading(false)
    }
  }, [filters, setPositions, setPositionsLoading])

  // Load data when tab or filters change
  useEffect(() => {
    if (activeTab === 'orders') {
      loadOrders()
    } else if (activeTab === 'positions') {
      loadPositions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filters.status, filters.symbol, filters.userId, filters.groupId, filters.search])

  // Load positions on mount so data is ready when user switches to Positions tab
  useEffect(() => {
    loadPositions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ordersArray = useMemo(() => getOrdersArray(), [orders])
  const positionsArray = useMemo(() => getPositionsArray(), [positions])

  // Stats derived from current positions and orders (respects filters)
  const openPositionsCount = positionsArray.length
  const totalExposure = useMemo(
    () => positionsArray.reduce((sum, p) => sum + (p.marginUsed ?? 0), 0),
    [positionsArray]
  )
  // Same logic as PositionsTable: live mark when available, else compute from markPrice, else API pnl
  const livePnl = useMemo(() => {
    return positionsArray.reduce((sum, p) => {
      const liveMark = p.symbol ? liveMarkBySymbol[p.symbol.toUpperCase()] : undefined
      const hasLive = typeof liveMark === 'number' && Number.isFinite(liveMark)
      if (hasLive) {
        return sum + computePositionPnl(p.entryPrice, liveMark, p.size, p.side)
      }
      // Prefer computed from mark so we show real PnL when backend sends pnl: 0 (e.g. Redis unrealized_pnl not set)
      const mark = typeof p.markPrice === 'number' && Number.isFinite(p.markPrice) ? p.markPrice : p.entryPrice
      if (p.size > 0 && Number.isFinite(p.entryPrice)) {
        return sum + computePositionPnl(p.entryPrice, mark, p.size, p.side)
      }
      return sum + (typeof p.pnl === 'number' ? p.pnl : 0)
    }, 0)
  }, [positionsArray, liveMarkBySymbol])
  const activeOrdersCount = useMemo(
    () => ordersArray.filter((o) => o.status === 'pending' || o.status === 'PENDING').length,
    [ordersArray]
  )

  // Live PnL: subscribe to price stream for position symbols (event-driven, no polling)
  useAdminTradingLivePrices(positionsArray)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

  return (
    <ContentShell>
      <PageHeader
        title="Trading"
        description="Monitor orders, positions, and apply trading controls in real-time."
        actions={
          <div className="flex items-center gap-2">
            {canCreateOrder && (
              <Button variant="primary" onClick={() => setOpenModal('create-order')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Order
              </Button>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-blue-500">
            <LayoutList className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Open positions</p>
            <p className="mt-1 text-lg font-bold text-text">{openPositionsCount}</p>
            <p className="mt-0.5 text-xs text-text-muted">In current view</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-slate-400">
            <DollarSign className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Exposure</p>
            <p className="mt-1 text-lg font-bold text-text">{formatCurrency(totalExposure)}</p>
            <p className="mt-0.5 text-xs text-text-muted">Margin used</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-emerald-500">
            <TrendingUp className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Live PnL</p>
            <p
              className={`mt-1 text-lg font-bold ${livePnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
            >
              {formatCurrency(livePnl)}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Unrealized</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-amber-500">
            <ClipboardList className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Active orders</p>
            <p className="mt-1 text-lg font-bold text-text">{activeOrdersCount}</p>
            <p className="mt-0.5 text-xs text-text-muted">Pending</p>
          </div>
        </Card>
      </div>

      <TradingFiltersBar />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-6 w-full">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Loading orders...</p>
            </div>
          ) : (
            <OrdersTable orders={ordersArray} />
          )}
        </TabsContent>

        <TabsContent value="positions" className="mt-4">
          {positionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Loading positions...</p>
            </div>
          ) : (
            <PositionsTable positions={positionsArray} />
          )}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <OrderCreateModal />
      <OrderDetailsModal />
      <PositionDetailsModal />
      <ClosePositionModal />
      <ModifySltpModal />
    </ContentShell>
  )
}
