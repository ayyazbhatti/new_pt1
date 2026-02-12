import { http } from '@/shared/api/http'
import { AdminOrder, CreateOrderRequest, PaginatedResponse, TradingFilters } from '../types'

export async function fetchAdminOrders(
  filters: TradingFilters = {}
): Promise<PaginatedResponse<AdminOrder>> {
  const params = new URLSearchParams()
  
  if (filters.status) params.append('status', filters.status)
  if (filters.symbol) params.append('symbol', filters.symbol)
  if (filters.userId) params.append('userId', filters.userId)
  if (filters.groupId) params.append('groupId', filters.groupId)
  if (filters.search) params.append('search', filters.search)
  if (filters.limit) params.append('limit', String(filters.limit))
  if (filters.cursor) params.append('cursor', filters.cursor)

  const query = params.toString()
  return http<PaginatedResponse<AdminOrder>>(`/api/admin/orders${query ? `?${query}` : ''}`)
}

export async function createAdminOrder(request: CreateOrderRequest): Promise<AdminOrder> {
  return http<AdminOrder>('/api/admin/orders', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function cancelAdminOrder(orderId: string): Promise<void> {
  return http(`/api/admin/orders/${orderId}/cancel`, {
    method: 'POST',
  })
}

export async function forceCancelAdminOrder(orderId: string): Promise<void> {
  return http(`/api/admin/orders/${orderId}/force`, {
    method: 'POST',
  })
}

