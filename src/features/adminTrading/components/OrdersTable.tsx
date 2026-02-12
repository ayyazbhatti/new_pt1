import React, { useMemo, useCallback, useRef } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AdminOrder } from '../types'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { MoreHorizontal, X, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { cancelAdminOrder, forceCancelAdminOrder } from '../api/orders'
import { toast } from 'react-hot-toast'
import { cn } from '@/shared/utils'

interface OrdersTableProps {
  orders: AdminOrder[]
  onOrderClick?: (order: AdminOrder) => void
}

export function OrdersTable({ orders, onOrderClick }: OrdersTableProps) {
  const { setSelectedOrderId, setOpenModal } = useAdminTradingStore()

  const handleCancel = useCallback(
    async (order: AdminOrder, e: React.MouseEvent) => {
      e.stopPropagation()
      try {
        await cancelAdminOrder(order.id)
        // Wait for WS event to update status
      } catch (error: any) {
        toast.error(error?.response?.data?.error?.message || 'Failed to cancel order')
      }
    },
    []
  )

  const handleForceCancel = useCallback(
    async (order: AdminOrder, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm(`Force cancel order ${order.id.slice(0, 8)}...? This action cannot be undone.`)) {
        return
      }
      try {
        await forceCancelAdminOrder(order.id)
        // Wait for WS event to update status
      } catch (error: any) {
        toast.error(error?.response?.data?.error?.message || 'Failed to force cancel order')
      }
    },
    []
  )

  const handleRowClick = useCallback(
    (order: AdminOrder) => {
      setSelectedOrderId(order.id)
      setOpenModal('order-details')
      onOrderClick?.(order)
    },
    [setSelectedOrderId, setOpenModal, onOrderClick]
  )

  const columns: ColumnDef<AdminOrder>[] = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Order ID',
        cell: ({ row }) => (
          <button
            onClick={() => handleRowClick(row.original)}
            className="font-mono text-xs text-accent hover:underline"
          >
            {row.original.id.slice(0, 8)}...
          </button>
        ),
      },
      {
        accessorKey: 'userName',
        header: 'User',
        cell: ({ row }) => (
          <div>
            <div className="text-sm font-medium text-text">{row.original.userName}</div>
            <div className="text-xs text-text-muted">{row.original.userEmail}</div>
          </div>
        ),
      },
      {
        accessorKey: 'groupName',
        header: 'Group',
        cell: ({ row }) => <span className="text-sm text-text">{row.original.groupName}</span>,
      },
      {
        accessorKey: 'symbol',
        header: 'Symbol',
        cell: ({ row }) => <span className="text-sm font-medium text-text">{row.original.symbol}</span>,
      },
      {
        accessorKey: 'side',
        header: 'Side',
        cell: ({ row }) => (
          <Badge variant={row.original.side === 'BUY' ? 'success' : 'danger'}>
            {row.original.side}
          </Badge>
        ),
      },
      {
        accessorKey: 'orderType',
        header: 'Type',
        cell: ({ row }) => <span className="text-sm text-text">{row.original.orderType}</span>,
      },
      {
        accessorKey: 'size',
        header: 'Size',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">{row.original.size.toLocaleString()}</span>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Price',
        cell: ({ row }) => (
          <span className="text-sm font-mono text-text">
            {row.original.price ? row.original.price.toFixed(2) : 'MKT'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status
          const variant =
            status === 'filled'
              ? 'success'
              : status === 'cancelled' || status === 'rejected'
                ? 'danger'
                : status === 'pending'
                  ? 'warning'
                  : 'neutral'
          return <Badge variant={variant}>{status.toUpperCase()}</Badge>
        },
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-xs text-text-muted">
            {format(new Date(row.original.createdAt), 'MMM dd, HH:mm')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const order = row.original
          const canCancel = order.status === 'pending' || order.status === 'open'
          return (
            <div className="flex items-center gap-1">
              {canCancel && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleCancel(order, e)}
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleForceCancel(order, e)}
                    title="Force Cancel"
                    className="text-danger hover:text-danger"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRowClick(order)}
                title="Details"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          )
        },
      },
    ],
    [handleCancel, handleForceCancel, handleRowClick]
  )

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56, // Row height
    overscan: 10,
  })

  if (orders.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <p>No orders found</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="bg-surface-2 border-b border-border sticky top-0 z-10">
        <table className="w-full">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id || column.accessorKey}
                  className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  {typeof column.header === 'string' ? column.header : '—'}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      {/* Virtualized Body */}
      <div ref={parentRef} className="h-[600px] overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const order = orders[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={cn(
                  'border-b border-border hover:bg-surface-2/50 transition-colors cursor-pointer',
                  'flex items-center'
                )}
                onClick={() => handleRowClick(order)}
              >
                <table className="w-full">
                  <tbody>
                    <tr>
                      {columns.map((column) => (
                        <td
                          key={column.id || column.accessorKey}
                          className="px-4 py-3"
                          onClick={(e) => {
                            // Prevent row click for action buttons
                            if (column.id === 'actions') {
                              e.stopPropagation()
                            }
                          }}
                        >
                          {column.cell
                            ? flexRender(column.cell, {
                                row: { original: order, getValue: () => order },
                              } as any)
                            : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { flexRender } from '@tanstack/react-table'

