// Extended types for admin trading with full API support

export type OrderStatus = 'pending' | 'PENDING' | 'filled' | 'cancelled' | 'rejected' | 'open'
export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'
export type PositionSide = 'LONG' | 'SHORT'
export type PositionStatus = 'OPEN' | 'open' | 'CLOSED' | 'closed' | 'LIQUIDATED'
export type TimeInForce = 'GTC' | 'IOC' | 'FOK'

export interface AdminOrder {
  id: string
  userId: string
  userName: string
  userEmail?: string
  userFirstName?: string
  userLastName?: string
  groupId: string
  groupName: string
  symbolId: string
  symbol: string
  side: OrderSide
  orderType: OrderType
  size: number
  filledSize?: number
  price?: number
  stopPrice?: number
  timeInForce?: TimeInForce
  status: OrderStatus
  averagePrice?: number
  createdAt: string
  updatedAt: string
  cancelledAt?: string
  filledAt?: string
  rejectedAt?: string
  rejectionReason?: string
}

export interface AdminPosition {
  id: string
  userId: string
  userName: string
  userEmail?: string
  groupId: string
  groupName: string
  symbolId: string
  symbol: string
  side: PositionSide
  size: number
  entryPrice: number
  markPrice: number
  leverage: number
  marginUsed: number
  marginAvailable?: number
  liquidationPrice: number
  pnl: number
  pnlPercent: number
  status: PositionStatus
  stopLoss?: number
  takeProfit?: number
  openedAt: string
  closedAt?: string
  lastUpdatedAt: string
}

export interface AdminAuditLog {
  id: string
  timestamp: string
  adminId: string
  adminEmail: string
  action: string
  targetType: 'order' | 'position' | 'user' | 'system'
  targetId: string
  details?: Record<string, any>
  ipAddress?: string
}

export interface TradingFilters {
  status?: string
  symbol?: string
  userId?: string
  groupId?: string
  search?: string
  limit?: number
  cursor?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  cursor?: string
  hasMore: boolean
  total?: number
  /** Open positions API: sum of margin across all matching positions */
  totalMarginUsed?: number
  /** Open positions API: sum of unrealized PnL (Redis) across all matching positions */
  totalUnrealizedPnl?: number
}

export interface LookupSymbol {
  id: string
  code: string
  name: string
  assetClass: string
}

export interface LookupUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  groupId: string
  groupName: string
}

export interface LookupGroup {
  id: string
  name: string
}

export interface CreateOrderRequest {
  userId: string
  symbolId: string
  side: OrderSide
  orderType: OrderType
  size: number
  price?: number
  stopPrice?: number
  timeInForce?: TimeInForce
  stopLoss?: number
  takeProfit?: number
}

export interface ClosePositionRequest {
  size?: number // If omitted, closes full position
}

export interface ModifySltpRequest {
  stopLoss?: number
  takeProfit?: number
}

