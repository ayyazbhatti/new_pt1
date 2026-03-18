import { ModalShell } from '@/shared/ui/modal'
import { Badge } from '@/shared/ui/badge'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { format } from 'date-fns'

export function OrderDetailsModal() {
  const { openModal, setOpenModal, selectedOrderId, orders, orderHistory } = useAdminTradingStore()
  const order = selectedOrderId
    ? orders.get(selectedOrderId) ?? orderHistory.get(selectedOrderId)
    : null
  const open = openModal === 'order-details'

  if (!order) return null

  return (
    <ModalShell
      open={open}
      onOpenChange={(open) => setOpenModal(open ? 'order-details' : null)}
      title="Order Details"
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-muted mb-1">Order ID</div>
            <div className="font-mono text-sm text-text">{order.id}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Status</div>
            <Badge
              variant={
                order.status === 'filled'
                  ? 'success'
                  : order.status === 'cancelled' || order.status === 'rejected'
                    ? 'danger'
                    : 'warning'
              }
            >
              {order.status.toUpperCase()}
            </Badge>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">User</div>
            <div className="text-sm text-text">{order.userName}</div>
            <div className="text-xs text-text-muted">{order.userEmail}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Group</div>
            <div className="text-sm text-text">{order.groupName}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Symbol</div>
            <div className="text-sm font-medium text-text">{order.symbol}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Side</div>
            <Badge variant={order.side === 'BUY' ? 'success' : 'danger'}>{order.side}</Badge>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Type</div>
            <div className="text-sm text-text">{order.orderType}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted mb-1">Size</div>
            <div className="text-sm font-mono text-text">{order.size.toLocaleString()}</div>
          </div>
          {order.price && (
            <div>
              <div className="text-xs text-text-muted mb-1">Price</div>
              <div className="text-sm font-mono text-text">${order.price.toFixed(2)}</div>
            </div>
          )}
          {order.filledSize && (
            <div>
              <div className="text-xs text-text-muted mb-1">Filled Size</div>
              <div className="text-sm font-mono text-text">{order.filledSize.toLocaleString()}</div>
            </div>
          )}
          {order.averagePrice && (
            <div>
              <div className="text-xs text-text-muted mb-1">Average Price</div>
              <div className="text-sm font-mono text-text">${order.averagePrice.toFixed(2)}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-text-muted mb-1">Created</div>
            <div className="text-sm text-text">{format(new Date(order.createdAt), 'PPpp')}</div>
          </div>
          {order.filledAt && (
            <div>
              <div className="text-xs text-text-muted mb-1">Filled</div>
              <div className="text-sm text-text">{format(new Date(order.filledAt), 'PPpp')}</div>
            </div>
          )}
          {order.rejectionReason && (
            <div className="col-span-2">
              <div className="text-xs text-text-muted mb-1">Rejection Reason</div>
              <div className="text-sm text-danger">{order.rejectionReason}</div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

