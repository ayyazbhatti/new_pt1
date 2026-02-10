import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Order } from '../types/adminTrading'
import { useModalStore } from '@/app/store'
import { OrderDetailsModal } from '../modals/OrderDetailsModal'
import { ConfirmActionModal } from '../modals/ConfirmActionModal'
import { Eye, X, CheckCircle } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { filterOrders } from '../utils/filters'
import { formatDateTime } from '../utils/formatters'
import { mockGroups } from '../mocks/groups.mock'
import { mockOrders } from '../mocks/orders.mock'

export function OrdersAdminPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [orders, setOrders] = useState<Order[]>(mockOrders)
  const [filters, setFilters] = useState({
    status: 'all',
    side: 'all',
    type: 'all',
    group: 'all',
    symbol: '',
  })

  const filteredOrders = useMemo(() => {
    return filterOrders(orders, filters)
  }, [orders, filters])

  const handleView = (order: Order) => {
    openModal(`order-details-${order.id}`, <OrderDetailsModal order={order} />, {
      title: `Order Details - ${order.id}`,
      size: 'lg',
    })
  }

  const handleCancel = (order: Order) => {
    const modalKey = `cancel-order-${order.id}`
    openModal(
      modalKey,
      <ConfirmActionModal
        title="Cancel Order"
        message={`Are you sure you want to cancel order ${order.id}?`}
        onConfirm={() => {
          setOrders(
            orders.map((o) =>
              o.id === order.id ? { ...o, status: 'cancelled' as const, cancelledAt: new Date().toISOString() } : o
            )
          )
          toast.success(`Order ${order.id} cancelled`)
        }}
        modalKey={modalKey}
      />,
      {
        title: 'Confirm Cancel',
        size: 'sm',
      }
    )
  }

  const handleForceFill = (order: Order) => {
    const modalKey = `force-fill-${order.id}`
    openModal(
      modalKey,
      <ConfirmActionModal
        title="Force Fill Order"
        message={`Force fill order ${order.id} at current market price?`}
        onConfirm={() => {
          setOrders(
            orders.map((o) =>
              o.id === order.id
                ? {
                    ...o,
                    status: 'filled' as const,
                    filledSize: o.size,
                    averagePrice: o.price || 1000,
                    filledAt: new Date().toISOString(),
                  }
                : o
            )
          )
          toast.success(`Order ${order.id} force filled`)
        }}
        modalKey={modalKey}
      />,
      {
        title: 'Confirm Force Fill',
        size: 'sm',
      }
    )
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'danger' | 'neutral' | 'warning'> = {
      filled: 'success',
      pending: 'warning',
      cancelled: 'neutral',
      rejected: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
  }

  const getSideBadge = (side: string) => {
    return (
      <Badge variant={side === 'buy' ? 'success' : 'danger'} className="uppercase">
        {side}
      </Badge>
    )
  }

  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: 'id',
      header: 'Order ID',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('id')}</span>
      },
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => {
        const order = row.original
        return (
          <div>
            <div className="text-sm text-text">{order.userName}</div>
            <div className="text-xs text-text-muted font-mono">{order.userId}</div>
          </div>
        )
      },
    },
    {
      accessorKey: 'groupName',
      header: 'Group',
    },
    {
      accessorKey: 'symbol',
      header: 'Symbol',
      cell: ({ row }) => {
        return <span className="font-mono font-semibold">{row.getValue('symbol')}</span>
      },
    },
    {
      accessorKey: 'side',
      header: 'Side',
      cell: ({ row }) => getSideBadge(row.getValue('side')),
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        return <span className="capitalize">{row.getValue('type')}</span>
      },
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ row }) => {
        return <span className="font-mono">{row.getValue('size')}</span>
      },
    },
    {
      id: 'price',
      header: 'Price',
      cell: ({ row }) => {
        const order = row.original
        if (order.price) {
          return <span className="font-mono">{order.price.toFixed(2)}</span>
        }
        if (order.stopPrice) {
          return <span className="font-mono text-text-muted">Stop: {order.stopPrice.toFixed(2)}</span>
        }
        return <span className="text-text-muted">Market</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => getStatusBadge(row.getValue('status')),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('createdAt'))}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const order = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleView(order)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            {order.status === 'pending' && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCancel(order)}
                  title="Cancel"
                  className="text-warning hover:text-warning hover:bg-warning/10"
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleForceFill(order)}
                  title="Force Fill"
                  className="text-success hover:text-success hover:bg-success/10"
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <Select
          value={filters.status}
          onValueChange={(value) => setFilters({ ...filters, status: value })}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="filled">Filled</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.side} onValueChange={(value) => setFilters({ ...filters, side: value })}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Side" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="buy">Buy</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.type} onValueChange={(value) => setFilters({ ...filters, type: value })}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="market">Market</SelectItem>
            <SelectItem value="limit">Limit</SelectItem>
            <SelectItem value="stop">Stop</SelectItem>
            <SelectItem value="stopLimit">Stop Limit</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.group}
          onValueChange={(value) => setFilters({ ...filters, group: value })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {mockGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="search"
          placeholder="Search symbols..."
          value={filters.symbol}
          onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
          className="flex-1 max-w-sm"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilters({ status: 'all', side: 'all', type: 'all', group: 'all', symbol: '' })}
        >
          Clear
        </Button>
      </div>
      <DataTable data={filteredOrders} columns={columns} />
    </div>
  )
}

