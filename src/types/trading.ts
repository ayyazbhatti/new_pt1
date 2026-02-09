export interface Symbol {
  id: string
  name: string
  base: string
  quote: string
  price: number
  change24h: number
  volume24h: number
}

export interface Order {
  id: string
  symbol: string
  type: 'market' | 'limit'
  side: 'buy' | 'sell'
  size: number
  price?: number
  status: 'open' | 'filled' | 'cancelled'
  createdAt: Date
}

export interface Position {
  id: string
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  currentPrice: number
  pnl: number
  pnlPercent: number
  leverage: number
  margin: number
  createdAt: Date
}

export interface PositionHistory {
  id: string
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPercent: number
  leverage: number
  openedAt: Date
  closedAt: Date
}

export type OrderType = 'market' | 'limit'
export type OrderSide = 'buy' | 'sell'
export type PositionSide = 'long' | 'short'
