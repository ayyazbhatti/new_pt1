import { Order, Position, MarginEvent } from '../types/adminTrading'

export function filterOrders(
  orders: Order[],
  filters: {
    status?: string
    side?: string
    type?: string
    group?: string
    symbol?: string
  }
): Order[] {
  return orders.filter((order) => {
    if (filters.status && filters.status !== 'all' && order.status !== filters.status) {
      return false
    }
    if (filters.side && filters.side !== 'all' && order.side !== filters.side) {
      return false
    }
    if (filters.type && filters.type !== 'all' && order.type !== filters.type) {
      return false
    }
    if (filters.group && filters.group !== 'all' && order.groupId !== filters.group) {
      return false
    }
    if (filters.symbol) {
      const searchLower = filters.symbol.toLowerCase()
      if (!order.symbol.toLowerCase().includes(searchLower)) {
        return false
      }
    }
    return true
  })
}

export function filterPositions(
  positions: Position[],
  filters: {
    status?: string
    side?: string
    group?: string
    symbol?: string
    minPnl?: number
    maxPnl?: number
  }
): Position[] {
  return positions.filter((position) => {
    if (filters.status && position.status !== filters.status) {
      return false
    }
    if (filters.side && filters.side !== 'all' && position.side !== filters.side) {
      return false
    }
    if (filters.group && filters.group !== 'all' && position.groupId !== filters.group) {
      return false
    }
    if (filters.symbol) {
      const searchLower = filters.symbol.toLowerCase()
      if (!position.symbol.toLowerCase().includes(searchLower)) {
        return false
      }
    }
    if (filters.minPnl !== undefined && position.pnl < filters.minPnl) {
      return false
    }
    if (filters.maxPnl !== undefined && position.pnl > filters.maxPnl) {
      return false
    }
    return true
  })
}

export function filterMarginEvents(
  events: MarginEvent[],
  filters: {
    type?: string
    severity?: string
    group?: string
    symbol?: string
    user?: string
  }
): MarginEvent[] {
  return events.filter((event) => {
    if (filters.type && filters.type !== 'all' && event.type !== filters.type) {
      return false
    }
    if (filters.severity && filters.severity !== 'all' && event.severity !== filters.severity) {
      return false
    }
    if (filters.group && filters.group !== 'all' && event.groupId !== filters.group) {
      return false
    }
    if (filters.symbol) {
      const searchLower = filters.symbol.toLowerCase()
      if (!event.symbol.toLowerCase().includes(searchLower)) {
        return false
      }
    }
    if (filters.user) {
      const searchLower = filters.user.toLowerCase()
      if (
        !event.userName.toLowerCase().includes(searchLower) &&
        !event.userId.toLowerCase().includes(searchLower)
      ) {
        return false
      }
    }
    return true
  })
}

