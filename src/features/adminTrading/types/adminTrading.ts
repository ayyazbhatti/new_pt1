export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected'
export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop' | 'stopLimit'
export type PositionSide = 'long' | 'short'
export type PositionStatus = 'open' | 'closed'
export type MarginEventType = 'margin_call' | 'liquidation'
export type EventSeverity = 'low' | 'medium' | 'high'

export interface Order {
  id: string
  userId: string
  userName: string
  groupId: string
  groupName: string
  symbol: string
  side: OrderSide
  type: OrderType
  size: number
  price?: number
  stopPrice?: number
  status: OrderStatus
  filledSize?: number
  averagePrice?: number
  createdAt: string
  updatedAt: string
  cancelledAt?: string
  filledAt?: string
}

export interface Position {
  id: string
  userId: string
  userName: string
  groupId: string
  groupName: string
  symbol: string
  side: PositionSide
  size: number
  entryPrice: number
  markPrice: number
  leverage: number
  marginUsed: number
  liquidationPrice: number
  pnl: number
  pnlPercent: number
  status: PositionStatus
  openedAt: string
  closedAt?: string
}

export interface MarginEvent {
  id: string
  time: string
  type: MarginEventType
  severity: EventSeverity
  userId: string
  userName: string
  groupId: string
  groupName: string
  symbol: string
  equity: number
  margin: number
  maintenance: number
  freeMargin: number
  message: string
  acknowledged: boolean
}

export interface SymbolControl {
  symbol: string
  tradingEnabled: boolean
  closeOnly: boolean
  allowNewOrders: boolean
  maxLeverageCap: number
  maxOrderSize: number
  maxPositionSize: number
}

export interface GroupControl {
  groupId: string
  groupName: string
  tradingEnabled: boolean
  closeOnly: boolean
  maxLeverageMin: number
  maxLeverageMax: number
  maxOpenPositionsPerUser: number
}

export interface AuditLogEntry {
  id: string
  time: string
  admin: string
  action: string
  target: string
}

