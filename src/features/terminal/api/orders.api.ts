import { http } from '@/shared/api/http'

export interface PlaceOrderRequest {
  symbol: string
  side: 'BUY' | 'SELL'
  order_type: 'MARKET' | 'LIMIT'
  size: string
  limit_price?: string
  sl?: string
  tp?: string
  tif?: 'GTC' | 'IOC' | 'FOK'
  client_order_id?: string
  idempotency_key: string
}

export interface PlaceOrderResponse {
  orderId: string  // API returns camelCase
  status: string
}

export async function placeOrder(payload: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return http<PlaceOrderResponse>('/v1/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function cancelOrder(orderId: string): Promise<void> {
  return http(`/v1/orders/${orderId}/cancel`, {
    method: 'POST',
  })
}

export interface Order {
  id: string
  symbol: string
  side: string
  order_type: string
  size: string
  price?: string
  stop_price?: string
  filled_size?: string
  average_price?: string
  status: string
  created_at: string
  updated_at: string
  filled_at?: string
  cancelled_at?: string
}

export interface ListOrdersResponse {
  items: Order[]
  total: number
}

export interface ListOrdersParams {
  status?: string // "pending", "filled", "cancelled", etc.
  limit?: number
  offset?: number
}

export async function listOrders(params?: ListOrdersParams): Promise<ListOrdersResponse> {
  const queryParams = new URLSearchParams()
  if (params?.status) queryParams.append('status', params.status)
  if (params?.limit) queryParams.append('limit', params.limit.toString())
  if (params?.offset) queryParams.append('offset', params.offset.toString())

  const queryString = queryParams.toString()
  const endpoint = `/v1/orders${queryString ? `?${queryString}` : ''}`

  return http<ListOrdersResponse>(endpoint, {
    method: 'GET',
  })
}

