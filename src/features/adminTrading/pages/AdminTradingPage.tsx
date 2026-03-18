import { useEffect, useMemo, useCallback, useState } from 'react'
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
import { toast } from '@/shared/components/common'
import { TradingTablePagination, PAGE_SIZE } from '../components/TradingTablePagination'

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
    orderHistory,
    orderHistoryLoading,
    positionHistory,
    positionHistoryLoading,
    setOrderHistory,
    setOrderHistoryLoading,
    setPositionHistory,
    setPositionHistoryLoading,
    setOpenModal,
  } = useAdminTradingStore()

  const [ordersPage, setOrdersPage] = useState(1)
  const [orderHistoryPage, setOrderHistoryPage] = useState(1)
  const [positionsPage, setPositionsPage] = useState(1)
  const [positionHistoryPage, setPositionHistoryPage] = useState(1)

  const [ordersTotal, setOrdersTotal] = useState<number | null>(null)
  const [orderHistoryTotal, setOrderHistoryTotal] = useState<number | null>(null)
  const [positionsTotal, setPositionsTotal] = useState<number | null>(null)
  const [positionHistoryTotal, setPositionHistoryTotal] = useState<number | null>(null)
  /** Portfolio-wide (all open positions matching filters) from API */
  const [overallExposure, setOverallExposure] = useState<number | null>(null)
  const [overallLivePnl, setOverallLivePnl] = useState<number | null>(null)

  const filterKey = `${filters.symbol ?? ''}|${filters.userId ?? ''}|${filters.groupId ?? ''}|${filters.search ?? ''}`

  const applyOpenPositionAggregates = (p: {
    total?: number
    totalMarginUsed?: number
    totalUnrealizedPnl?: number
  }) => {
    const n = p.total ?? 0
    if (n === 0) {
      setOverallExposure(0)
      setOverallLivePnl(0)
      return
    }
    if (typeof p.totalMarginUsed === 'number' && Number.isFinite(p.totalMarginUsed)) {
      setOverallExposure(p.totalMarginUsed)
    }
    if (typeof p.totalUnrealizedPnl === 'number' && Number.isFinite(p.totalUnrealizedPnl)) {
      setOverallLivePnl(p.totalUnrealizedPnl)
    }
  }

  useEffect(() => {
    setOrdersPage(1)
    setOrderHistoryPage(1)
    setPositionsPage(1)
    setPositionHistoryPage(1)
  }, [filterKey])

  const refreshTabTotals = useCallback(async () => {
    try {
      const cursor0 = '0'
      const [o, oh, p, ph] = await Promise.all([
        fetchAdminOrders({ ...filters, status: 'pending', limit: 1, cursor: cursor0 }),
        fetchAdminOrders({ ...filters, status: 'order-history', limit: 1, cursor: cursor0 }),
        fetchAdminPositions({ ...filters, status: 'open', limit: 1, cursor: cursor0 }),
        fetchAdminPositions({ ...filters, status: 'closed', limit: 1, cursor: cursor0 }),
      ])
      setOrdersTotal(o.total ?? o.items?.length ?? 0)
      setOrderHistoryTotal(oh.total ?? oh.items?.length ?? 0)
      setPositionsTotal(p.total ?? p.items?.length ?? 0)
      applyOpenPositionAggregates(p)
      setPositionHistoryTotal(ph.total ?? ph.items?.length ?? 0)
    } catch {
      /* tab totals best-effort */
    }
  }, [filters])

  useEffect(() => {
    refreshTabTotals()
  }, [filterKey, refreshTabTotals])

  useAdminWebSocket()

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const response = await fetchAdminOrders({
        ...filters,
        status: 'pending',
        limit: PAGE_SIZE,
        cursor: String((ordersPage - 1) * PAGE_SIZE),
      })
      setOrders(response.items || [], response.cursor, response.hasMore)
      setOrdersTotal(response.total ?? response.items?.length ?? 0)
    } catch (error: any) {
      if (error?.response?.status === 404) {
        setOrders([], undefined, false)
        setOrdersTotal(0)
      } else {
        console.error('Failed to fetch orders:', error)
      }
    } finally {
      setOrdersLoading(false)
    }
  }, [filters, ordersPage, setOrders, setOrdersLoading])

  const loadOrderHistory = useCallback(async () => {
    setOrderHistoryLoading(true)
    try {
      const response = await fetchAdminOrders({
        ...filters,
        status: 'order-history',
        limit: PAGE_SIZE,
        cursor: String((orderHistoryPage - 1) * PAGE_SIZE),
      })
      setOrderHistory(response.items || [])
      setOrderHistoryTotal(response.total ?? response.items?.length ?? 0)
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        console.error('Failed to fetch order history:', error)
      }
      setOrderHistory([])
      setOrderHistoryTotal(0)
    } finally {
      setOrderHistoryLoading(false)
    }
  }, [filters, orderHistoryPage, setOrderHistory, setOrderHistoryLoading])

  const loadPositions = useCallback(async () => {
    setPositionsLoading(true)
    try {
      const response = await fetchAdminPositions({
        ...filters,
        status: 'open',
        limit: PAGE_SIZE,
        cursor: String((positionsPage - 1) * PAGE_SIZE),
      })
      const items = response?.items ?? []
      setPositions(items, response?.cursor, response?.hasMore ?? false)
      setPositionsTotal(response?.total ?? items.length)
      applyOpenPositionAggregates(response ?? {})
    } catch (error: any) {
      console.error('Failed to fetch positions:', error)
      setPositions([], undefined, false)
      setPositionsTotal(0)
      setOverallExposure(0)
      setOverallLivePnl(0)
      if (error?.response?.status !== 404) {
        toast.error(error?.response?.data?.error?.message || error?.message || 'Failed to load positions')
      }
    } finally {
      setPositionsLoading(false)
    }
  }, [filters, positionsPage, setPositions, setPositionsLoading])

  const loadPositionHistory = useCallback(async () => {
    setPositionHistoryLoading(true)
    try {
      const response = await fetchAdminPositions({
        ...filters,
        status: 'closed',
        limit: PAGE_SIZE,
        cursor: String((positionHistoryPage - 1) * PAGE_SIZE),
      })
      const items = response?.items ?? []
      setPositionHistory(items)
      setPositionHistoryTotal(response?.total ?? items.length)
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        console.error('Failed to fetch position history:', error)
      }
      setPositionHistory([])
      setPositionHistoryTotal(0)
    } finally {
      setPositionHistoryLoading(false)
    }
  }, [filters, positionHistoryPage, setPositionHistory, setPositionHistoryLoading])

  useEffect(() => {
    if (activeTab === 'orders') loadOrders()
  }, [activeTab, ordersPage, filterKey, loadOrders])

  useEffect(() => {
    if (activeTab === 'order-history') loadOrderHistory()
  }, [activeTab, orderHistoryPage, filterKey, loadOrderHistory])

  useEffect(() => {
    if (activeTab === 'positions') loadPositions()
  }, [activeTab, positionsPage, filterKey, loadPositions])

  useEffect(() => {
    if (activeTab === 'position-history') loadPositionHistory()
  }, [activeTab, positionHistoryPage, filterKey, loadPositionHistory])

  const ordersArray = useMemo(() => getOrdersArray(), [orders])
  const positionsArray = useMemo(() => getPositionsArray(), [positions])
  const orderHistoryArray = useMemo(() => Array.from(orderHistory.values()), [orderHistory])
  const positionHistoryArray = useMemo(() => Array.from(positionHistory.values()), [positionHistory])

  const openPositionsCount = positionsTotal ?? positionsArray.length
  const activeOrdersCount = ordersTotal ?? ordersArray.length

  useAdminTradingLivePrices(positionsArray)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

  const tabCount = (loading: boolean, total: number | null) =>
    loading ? '(…)' : `(${total ?? '—'})`

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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-blue-500">
            <LayoutList className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Open positions</p>
            <p className="mt-1 text-lg font-bold text-text">{openPositionsCount}</p>
            <p className="mt-0.5 text-xs text-text-muted">Total (filtered)</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-slate-400">
            <DollarSign className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Exposure</p>
            <p className="mt-1 text-lg font-bold text-text">
              {overallExposure !== null ? formatCurrency(overallExposure) : '—'}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Total margin (all open, filtered)</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-emerald-500">
            <TrendingUp className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Live PnL</p>
            <p
              className={`mt-1 text-lg font-bold ${
                overallLivePnl === null
                  ? 'text-text'
                  : overallLivePnl >= 0
                    ? 'text-emerald-600'
                    : 'text-red-600'
              }`}
            >
              {overallLivePnl !== null ? formatCurrency(overallLivePnl) : '—'}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Unrealized total (all open, filtered)</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-amber-500">
            <ClipboardList className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Active orders</p>
            <p className="mt-1 text-lg font-bold text-text">{activeOrdersCount}</p>
            <p className="mt-0.5 text-xs text-text-muted">Pending (filtered)</p>
          </div>
        </Card>
      </div>

      <TradingFiltersBar />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-6 w-full">
        <TabsList>
          <TabsTrigger value="orders">Orders {tabCount(ordersLoading && activeTab === 'orders', ordersTotal)}</TabsTrigger>
          <TabsTrigger value="order-history">
            Order History {tabCount(orderHistoryLoading && activeTab === 'order-history', orderHistoryTotal)}
          </TabsTrigger>
          <TabsTrigger value="positions">
            Positions {tabCount(positionsLoading && activeTab === 'positions', positionsTotal)}
          </TabsTrigger>
          <TabsTrigger value="position-history">
            Position History {tabCount(positionHistoryLoading && activeTab === 'position-history', positionHistoryTotal)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Loading orders...</p>
            </div>
          ) : (
            <>
              <OrdersTable orders={ordersArray} />
              <TradingTablePagination
                page={ordersPage}
                pageSize={PAGE_SIZE}
                total={ordersTotal}
                loading={ordersLoading}
                onPageChange={setOrdersPage}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="order-history" className="mt-4">
          {orderHistoryLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Loading order history...</p>
            </div>
          ) : (
            <>
              <OrdersTable orders={orderHistoryArray} />
              <TradingTablePagination
                page={orderHistoryPage}
                pageSize={PAGE_SIZE}
                total={orderHistoryTotal}
                loading={orderHistoryLoading}
                onPageChange={setOrderHistoryPage}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="positions" className="mt-4">
          {positionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Loading positions...</p>
            </div>
          ) : (
            <>
              <PositionsTable positions={positionsArray} />
              <TradingTablePagination
                page={positionsPage}
                pageSize={PAGE_SIZE}
                total={positionsTotal}
                loading={positionsLoading}
                onPageChange={setPositionsPage}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="position-history" className="mt-4">
          {positionHistoryLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-text-muted">Loading position history...</p>
            </div>
          ) : (
            <>
              <PositionsTable positions={positionHistoryArray} readOnly />
              <TradingTablePagination
                page={positionHistoryPage}
                pageSize={PAGE_SIZE}
                total={positionHistoryTotal}
                loading={positionHistoryLoading}
                onPageChange={setPositionHistoryPage}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <OrderCreateModal />
      <OrderDetailsModal />
      <PositionDetailsModal />
      <ClosePositionModal />
      <ModifySltpModal />
    </ContentShell>
  )
}
