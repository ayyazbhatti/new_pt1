// WebSocket Event Types for Deposit System

export type DepositRequestCreatePayload = {
  transactionId: string // Changed from requestId
  requestId?: string // Kept for backward compatibility
  userId: string
  amount: number
  currency: 'USD'
  note?: string
  createdAt: string
}

export type DepositRequestApprovePayload = {
  transactionId: string // Changed from requestId
  requestId?: string // Kept for backward compatibility
  adminId: string
  approvedAt: string
}

export type DepositRequestCreatedPayload = DepositRequestCreatePayload

export type DepositRequestApprovedPayload = {
  transactionId: string // Changed from requestId
  requestId?: string // Kept for backward compatibility
  userId: string
  amount: number
  currency: 'USD'
  approvedAt: string
  newBalance: number
}

export type NotificationPushPayload = {
  id: string
  kind: 'DEPOSIT_REQUEST' | 'DEPOSIT_APPROVED' | 'WITHDRAWAL_APPROVED' | 'POSITION_SL' | 'POSITION_TP'
  title: string
  message: string
  createdAt: string
  read: boolean
  meta?: Record<string, any>
}

export type AccountSummaryUpdatedPayload = {
  userId: string
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  marginLevel: string
  realizedPnl: number
  unrealizedPnl: number
  updatedAt: string
}

// Admin Trading WebSocket Events
export type AdminOrderCreatedPayload = {
  order: any
}

export type AdminOrderUpdatedPayload = {
  order: any
}

export type AdminOrderCanceledPayload = {
  orderId: string
  userId: string
  timestamp: string
}

export type AdminOrderFilledPayload = {
  orderId: string
  userId: string
  filledSize: number
  averagePrice: number
  timestamp: string
}

export type AdminOrderRejectedPayload = {
  orderId: string
  userId: string
  reason: string
  timestamp: string
}

export type AdminPositionOpenedPayload = {
  position: any
}

export type AdminPositionUpdatedPayload = {
  position: any
}

export type AdminPositionClosedPayload = {
  positionId: string
  userId: string
  closedSize: number
  pnl: number
  timestamp: string
}

export type AdminPositionLiquidatedPayload = {
  positionId: string
  userId: string
  timestamp: string
}

export type AdminPositionSltpModifiedPayload = {
  positionId: string
  userId: string
  stopLoss?: number
  takeProfit?: number
  timestamp: string
}

export type AdminMarginCallPayload = {
  userId: string
  equity: number
  marginUsed: number
  freeMargin: number
  timestamp: string
}

export type AdminLiquidationWarningPayload = {
  userId: string
  positionId: string
  liquidationPrice: number
  markPrice: number
  timestamp: string
}

export type AdminAuditAppendedPayload = {
  log: any
}

// Client → Server Events
export type WsOutboundEvent =
  | {
      type: 'auth'
      token: string
    }
  | {
      type: 'subscribe'
      symbols: string[]
      channels: string[]
    }
  | {
      type: 'unsubscribe'
      symbols: string[]
    }
  | {
      type: 'deposit.request.create'
      payload: DepositRequestCreatePayload
    }
  | {
      type: 'deposit.request.approve'
      payload: DepositRequestApprovePayload
    }

// Server → Client Events
export type WsInboundEvent =
  | {
      type: 'auth_success'
      user_id: string
      group_id?: string
    }
  | {
      type: 'auth_error'
      error: string
    }
  | {
      type: 'deposit.request.created'
      payload: DepositRequestCreatedPayload
    }
  | {
      type: 'deposit.request.approved'
      payload: DepositRequestApprovedPayload
    }
  | {
      type: 'notification.push'
      payload: NotificationPushPayload
    }
  | {
      type: 'wallet.balance.updated'
      payload: {
        userId: string
        balance: number
        currency: string
        available: number
        locked: number
        equity: number
        margin_used: number
        free_margin: number
        updatedAt: string
      }
    }
  | {
      type: 'account.summary.updated'
      payload: AccountSummaryUpdatedPayload
    }
  | {
      type: 'withdrawal.request.approved'
      payload: {
        userId: string
        amount: number
        currency: string
        approvedAt: string
        newBalance: number
        requestId: string
      }
    }
  | {
      type: 'admin.order.created'
      payload: AdminOrderCreatedPayload
    }
  | {
      type: 'admin.order.updated'
      payload: AdminOrderUpdatedPayload
    }
  | {
      type: 'admin.order.canceled'
      payload: AdminOrderCanceledPayload
    }
  | {
      type: 'admin.order.filled'
      payload: AdminOrderFilledPayload
    }
  | {
      type: 'admin.order.rejected'
      payload: AdminOrderRejectedPayload
    }
  | {
      type: 'admin.position.opened'
      payload: AdminPositionOpenedPayload
    }
  | {
      type: 'admin.position.updated'
      payload: AdminPositionUpdatedPayload
    }
  | {
      type: 'admin.position.closed'
      payload: AdminPositionClosedPayload
    }
  | {
      type: 'admin.position.liquidated'
      payload: AdminPositionLiquidatedPayload
    }
  | {
      type: 'admin.position.sltp.modified'
      payload: AdminPositionSltpModifiedPayload
    }
  | {
      type: 'admin.margin.call'
      payload: AdminMarginCallPayload
    }
  | {
      type: 'admin.liquidation.warning'
      payload: AdminLiquidationWarningPayload
    }
  | {
      type: 'admin.audit.appended'
      payload: AdminAuditAppendedPayload
    }
  | {
      type: 'tick'
      symbol: string
      bid: string
      ask: string
      ts: number
    }
  | {
      type: 'chat.message'
      payload: {
        id: string
        userId: string
        senderType: 'user' | 'support'
        senderId: string | null
        body: string
        createdAt: string
      }
    }
  | {
      type: 'error'
      message: string
    }

