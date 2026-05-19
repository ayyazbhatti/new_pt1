import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useCanAccess } from '@/shared/utils/permissions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { Plus, LayoutList, DollarSign, TrendingUp, ClipboardList } from 'lucide-react'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { fetchAdminOrders } from '../api/orders'
import { fetchAdminPositions } from '../api/positions'
import { TradingTabToolbar } from '../components/TradingTabToolbar'
import { OrdersTable } from '../components/OrdersTable'
import { PositionsTable } from '../components/PositionsTable'
import { OrderCreateModal } from '../components/OrderCreateModal'
import { OrderDetailsModal } from '../components/OrderDetailsModal'
import { PositionDetailsModal } from '../components/PositionDetailsModal'
import { ClosePositionModal } from '../components/ClosePositionModal'
import { ModifySltpModal } from '../components/ModifySltpModal'
import { ModifyPositionModal } from '../components/ModifyPositionModal'
import { useAdminWebSocket } from '../hooks/useAdminWebSocket'
import { useAdminTradingLivePrices } from '../hooks/useAdminTradingLivePrices'
import { useTradingLookups } from '../hooks/useTradingLookups'
import { toast } from '@/shared/components/common'
import { TradingTablePagination, PAGE_SIZE } from '../components/TradingTablePagination'
import { TabListQuery, tabListQueryKey, toTradingFilters } from '../types'

export function AdminTradingPage() {
  const canCreateOrder = useCanAccess('trading:create_order')
  const {
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
    setSymbols,
    setGroups,
  } = useAdminTradingStore()

  const { symbols, groups, loading: lookupsLoading } = useTradingLookups()

  const [ordersQuery, setOrdersQuery] = useState<TabListQuery>({})
  const [orderHistoryQuery, setOrderHistoryQuery] = useState<TabListQuery>({})
  const [positionsQuery, setPositionsQuery] = useState<TabListQuery>({})
  const [positionHistoryQuery, setPositionHistoryQuery] = useState<TabListQuery>({})

  const ordersFilterKey = tabListQueryKey(ordersQuery)
  const orderHistoryFilterKey = tabListQueryKey(orderHistoryQuery)
  const positionsFilterKey = tabListQueryKey(positionsQuery)
  const positionHistoryFilterKey = tabListQueryKey(positionHistoryQuery)

  useEffect(() => {
    setSymbols(symbols)
    setGroups(groups)
  }, [symbols, groups, setSymbols, setGroups])

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
  const [overallRealizedPnl, setOverallRealizedPnl] = useState<number | null>(null)
  const totalsRequestSeq = useRef(0)
  const ordersRequestSeq = useRef(0)
  const orderHistoryRequestSeq = useRef(0)
  const positionsRequestSeq = useRef(0)
  const positionHistoryRequestSeq = useRef(0)

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

  const applyClosedPositionAggregates = (p: {
    total?: number
    totalRealizedPnl?: number
  }) => {
    if ((p.total ?? 0) === 0) {
      setOverallRealizedPnl(0)
      return
    }
    if (typeof p.totalRealizedPnl === 'number' && Number.isFinite(p.totalRealizedPnl)) {
      setOverallRealizedPnl(p.totalRealizedPnl)
    }
  }

  useEffect(() => {
    setOrdersPage(1)
  }, [ordersFilterKey])

  useEffect(() => {
    setOrderHistoryPage(1)
  }, [orderHistoryFilterKey])

  useEffect(() => {
    setPositionsPage(1)
  }, [positionsFilterKey])

  useEffect(() => {
    setPositionHistoryPage(1)
  }, [positionHistoryFilterKey])

  const refreshTabTotals = useCallback(async () => {
    const requestSeq = ++totalsRequestSeq.current
    try {
      const cursor0 = '0'
      const [o, oh, p, ph] = await Promise.all([
        fetchAdminOrders({ status: 'pending', limit: 1, cursor: cursor0 }),
        fetchAdminOrders({ status: 'order-history', limit: 1, cursor: cursor0 }),
        fetchAdminPositions({ status: 'open', limit: 1, cursor: cursor0 }),
        fetchAdminPositions({ status: 'closed', limit: 1, cursor: cursor0 }),
      ])
      if (requestSeq !== totalsRequestSeq.current) return
      setOrdersTotal(o.total ?? o.items?.length ?? 0)
      setOrderHistoryTotal(oh.total ?? oh.items?.length ?? 0)
      setPositionsTotal(p.total ?? p.items?.length ?? 0)
      applyOpenPositionAggregates(p)
      setPositionHistoryTotal(ph.total ?? ph.items?.length ?? 0)
      applyClosedPositionAggregates(ph)
    } catch {
      /* tab totals best-effort */
    }
  }, [])

  useEffect(() => {
    refreshTabTotals()
  }, [refreshTabTotals])

  useAdminWebSocket()

  const loadOrders = useCallback(async () => {
    const requestSeq = ++ordersRequestSeq.current
    setOrdersLoading(true)
    try {
      const response = await fetchAdminOrders(
        toTradingFilters(ordersQuery, {
          status: 'pending',
          limit: PAGE_SIZE,
          cursor: String((ordersPage - 1) * PAGE_SIZE),
        })
      )
      if (requestSeq !== ordersRequestSeq.current) return
      setOrders(response.items || [], response.cursor, response.hasMore)
      setOrdersTotal(response.total ?? response.items?.length ?? 0)
    } catch (error: any) {
      if (requestSeq !== ordersRequestSeq.current) return
      if (error?.response?.status === 404) {
        setOrders([], undefined, false)
        setOrdersTotal(0)
      } else {
        console.error('Failed to fetch orders:', error)
      }
    } finally {
      if (requestSeq === ordersRequestSeq.current) {
        setOrdersLoading(false)
      }
    }
  }, [ordersQuery, ordersPage, setOrders, setOrdersLoading])

  const loadOrderHistory = useCallback(async () => {
    const requestSeq = ++orderHistoryRequestSeq.current
    setOrderHistoryLoading(true)
    try {
      const response = await fetchAdminOrders(
        toTradingFilters(orderHistoryQuery, {
          status: 'order-history',
          limit: PAGE_SIZE,
          cursor: String((orderHistoryPage - 1) * PAGE_SIZE),
        })
      )
      if (requestSeq !== orderHistoryRequestSeq.current) return
      setOrderHistory(response.items || [])
      setOrderHistoryTotal(response.total ?? response.items?.length ?? 0)
    } catch (error: any) {
      if (requestSeq !== orderHistoryRequestSeq.current) return
      if (error?.response?.status !== 404) {
        console.error('Failed to fetch order history:', error)
      }
      setOrderHistory([])
      setOrderHistoryTotal(0)
    } finally {
      if (requestSeq === orderHistoryRequestSeq.current) {
        setOrderHistoryLoading(false)
      }
    }
  }, [orderHistoryQuery, orderHistoryPage, setOrderHistory, setOrderHistoryLoading])

  const loadPositions = useCallback(async () => {
    const requestSeq = ++positionsRequestSeq.current
    setPositionsLoading(true)
    try {
      const response = await fetchAdminPositions(
        toTradingFilters(positionsQuery, {
          status: 'open',
          limit: PAGE_SIZE,
          cursor: String((positionsPage - 1) * PAGE_SIZE),
        })
      )
      if (requestSeq !== positionsRequestSeq.current) return
      const items = response?.items ?? []
      setPositions(items, response?.cursor, response?.hasMore ?? false)
      setPositionsTotal(response?.total ?? items.length)
      applyOpenPositionAggregates(response ?? {})
    } catch (error: any) {
      if (requestSeq !== positionsRequestSeq.current) return
      console.error('Failed to fetch positions:', error)
      setPositions([], undefined, false)
      setPositionsTotal(0)
      setOverallExposure(0)
      setOverallLivePnl(0)
      if (error?.response?.status !== 404) {
        toast.error(error?.response?.data?.error?.message || error?.message || 'Failed to load positions')
      }
    } finally {
      if (requestSeq === positionsRequestSeq.current) {
        setPositionsLoading(false)
      }
    }
  }, [positionsQuery, positionsPage, setPositions, setPositionsLoading])

  const loadPositionHistory = useCallback(async () => {
    const requestSeq = ++positionHistoryRequestSeq.current
    setPositionHistoryLoading(true)
    try {
      const response = await fetchAdminPositions(
        toTradingFilters(positionHistoryQuery, {
          status: 'closed',
          limit: PAGE_SIZE,
          cursor: String((positionHistoryPage - 1) * PAGE_SIZE),
        })
      )
      if (requestSeq !== positionHistoryRequestSeq.current) return
      const items = response?.items ?? []
      setPositionHistory(items)
      setPositionHistoryTotal(response?.total ?? items.length)
      applyClosedPositionAggregates(response ?? {})
    } catch (error: any) {
      if (requestSeq !== positionHistoryRequestSeq.current) return
      if (error?.response?.status !== 404) {
        console.error('Failed to fetch position history:', error)
      }
      setPositionHistory([])
      setPositionHistoryTotal(0)
      setOverallRealizedPnl(0)
    } finally {
      if (requestSeq === positionHistoryRequestSeq.current) {
        setPositionHistoryLoading(false)
      }
    }
  }, [positionHistoryQuery, positionHistoryPage, setPositionHistory, setPositionHistoryLoading])

  useEffect(() => {
    if (activeTab === 'orders') loadOrders()
  }, [activeTab, ordersPage, ordersFilterKey, loadOrders])

  useEffect(() => {
    if (activeTab === 'order-history') loadOrderHistory()
  }, [activeTab, orderHistoryPage, orderHistoryFilterKey, loadOrderHistory])

  useEffect(() => {
    if (activeTab === 'positions') loadPositions()
  }, [activeTab, positionsPage, positionsFilterKey, loadPositions])

  useEffect(() => {
    if (activeTab === 'position-history') loadPositionHistory()
  }, [activeTab, positionHistoryPage, positionHistoryFilterKey, loadPositionHistory])

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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-purple-500">
            <DollarSign className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Realized PnL</p>
            <p
              className={`mt-1 text-lg font-bold ${
                overallRealizedPnl === null
                  ? 'text-text'
                  : overallRealizedPnl >= 0
                    ? 'text-emerald-600'
                    : 'text-red-600'
              }`}
            >
              {overallRealizedPnl !== null ? formatCurrency(overallRealizedPnl) : '—'}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Closed positions (filtered)</p>
          </div>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
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
          <TradingTabToolbar
            query={ordersQuery}
            onQueryChange={setOrdersQuery}
            symbols={symbols}
            groups={groups}
            lookupsLoading={lookupsLoading}
          />
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
          <TradingTabToolbar
            query={orderHistoryQuery}
            onQueryChange={setOrderHistoryQuery}
            symbols={symbols}
            groups={groups}
            lookupsLoading={lookupsLoading}
          />
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
          <TradingTabToolbar
            query={positionsQuery}
            onQueryChange={setPositionsQuery}
            symbols={symbols}
            groups={groups}
            lookupsLoading={lookupsLoading}
          />
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
          <TradingTabToolbar
            query={positionHistoryQuery}
            onQueryChange={setPositionHistoryQuery}
            symbols={symbols}
            groups={groups}
            lookupsLoading={lookupsLoading}
          />
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
      <ModifyPositionModal />
      <ModifySltpModal />
    </ContentShell>
  )
}
