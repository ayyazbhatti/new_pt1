import { useEffect, useMemo, useCallback } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { Plus } from 'lucide-react'
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

  // Live PnL: subscribe to price stream for position symbols (event-driven, no polling)
  useAdminTradingLivePrices(positionsArray)

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
