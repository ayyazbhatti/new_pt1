import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import {
  AdminTradingHeader,
  TradingStatsCards,
  OrdersAdminPanel,
  PositionsAdminPanel,
  MarginEventsAdminPanel,
  TradingControlsAdminPanel,
} from '../components'
import { mockOrders } from '../mocks/orders.mock'
import { mockPositions } from '../mocks/positions.mock'
import { mockMarginEvents } from '../mocks/marginEvents.mock'
import { Download, RefreshCw, Plus } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useModalStore } from '@/app/store'

export function AdminTradingPage() {
  const openModal = useModalStore((state) => state.openModal)

  const handleExport = () => {
    toast.success('Export functionality coming soon')
  }

  const handleRefresh = () => {
    toast.success('Refresh functionality coming soon')
  }

  const handleManualOrder = () => {
    toast.success('Manual order functionality coming soon')
  }

  return (
    <ContentShell>
      <PageHeader
        title="Trading"
        description="Monitor orders, positions, margin events and apply trading controls."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" onClick={handleManualOrder}>
              <Plus className="h-4 w-4 mr-2" />
              Manual Order
            </Button>
          </div>
        }
      />
      <AdminTradingHeader />
      <TradingStatsCards
        orders={mockOrders}
        positions={mockPositions}
        marginEvents={mockMarginEvents}
      />
      <Tabs defaultValue="orders" className="w-full">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="margin-events">Margin Events</TabsTrigger>
          <TabsTrigger value="controls">Trading Controls</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <OrdersAdminPanel />
        </TabsContent>
        <TabsContent value="positions">
          <PositionsAdminPanel />
        </TabsContent>
        <TabsContent value="margin-events">
          <MarginEventsAdminPanel />
        </TabsContent>
        <TabsContent value="controls">
          <TradingControlsAdminPanel />
        </TabsContent>
      </Tabs>
    </ContentShell>
  )
}

