import { http } from '@/shared/api/http'
import { AdminPosition, ClosePositionRequest, ModifySltpRequest, PaginatedResponse, TradingFilters } from '../types'

export async function fetchAdminPositions(
  filters: TradingFilters = {}
): Promise<PaginatedResponse<AdminPosition>> {
  const params = new URLSearchParams()
  
  if (filters.status) params.append('status', filters.status)
  if (filters.symbol) params.append('symbol', filters.symbol)
  if (filters.userId) params.append('userId', filters.userId)
  if (filters.groupId) params.append('groupId', filters.groupId)
  if (filters.search) params.append('search', filters.search)
  if (filters.limit) params.append('limit', String(filters.limit))
  if (filters.cursor) params.append('cursor', filters.cursor)

  const query = params.toString()
  return http<PaginatedResponse<AdminPosition>>(`/api/admin/positions${query ? `?${query}` : ''}`)
}

export async function closeAdminPosition(
  positionId: string,
  request?: ClosePositionRequest
): Promise<void> {
  const endpoint = request?.size 
    ? `/api/admin/positions/${positionId}/close-partial`
    : `/api/admin/positions/${positionId}/close`
  
  return http(endpoint, {
    method: 'POST',
    body: request?.size ? JSON.stringify({ size: request.size }) : undefined,
  })
}

export async function modifyPositionSltp(
  positionId: string,
  request: ModifySltpRequest
): Promise<void> {
  return http(`/api/admin/positions/${positionId}/modify-sltp`, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function liquidatePosition(positionId: string): Promise<void> {
  return http(`/api/admin/positions/${positionId}/liquidate`, {
    method: 'POST',
  })
}

