import { http } from '@/shared/api/http'
import { useAuthStore } from '@/shared/store/auth.store'

export interface Position {
  id: string
  user_id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  size: string
  original_size?: string // Original size before closing (for closed positions)
  entry_price: string
  avg_price: string
  exit_price?: string // Exit price when position was closed
  sl?: string
  tp?: string
  leverage: string
  margin: string
  unrealized_pnl: string
  realized_pnl: string
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED'
  opened_at: number
  updated_at: number
  closed_at?: number // Timestamp when position was closed
}

export interface PositionsResponse {
  positions: Position[]
}

export type PositionsStatusFilter = 'open' | 'closed' | 'all'

export interface GetPositionsParams {
  status?: PositionsStatusFilter
  /** Max closed positions when status is `closed` (default 200, server cap 500). */
  limit?: number
  userId?: string
}

function buildPositionsQuery(params?: GetPositionsParams): string {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const s = q.toString()
  return s ? `?${s}` : ''
}

async function fetchPositionsForUser(
  userId: string,
  params?: GetPositionsParams
): Promise<Position[]> {
  const query = buildPositionsQuery(params)
  const response = await http<PositionsResponse>(`/v1/users/${userId}/positions${query}`)
  return response.positions || []
}

/** Open positions only — use for terminal Positions tab and chart markers (fast path). */
export async function getOpenPositions(userId?: string): Promise<Position[]> {
  const id = userId ?? useAuthStore.getState().user?.id
  if (!id) throw new Error('User not authenticated')
  return fetchPositionsForUser(id, { status: 'open' })
}

/** Closed/liquidated history — use when user opens Position History (paginated on server). */
export async function getClosedPositions(
  options?: { limit?: number; userId?: string }
): Promise<Position[]> {
  const id = options?.userId ?? useAuthStore.getState().user?.id
  if (!id) throw new Error('User not authenticated')
  return fetchPositionsForUser(id, { status: 'closed', limit: options?.limit ?? 200 })
}

/** All positions (open + closed). Prefer getOpenPositions / getClosedPositions for UI lists. */
export async function getPositions(params?: Omit<GetPositionsParams, 'userId'>): Promise<Position[]> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    throw new Error('User not authenticated')
  }
  return fetchPositionsForUser(userId, params?.status ? params : { status: 'all' })
}

/** Fetch positions for a specific user (admin only when viewing another user). Uses same endpoint; backend allows admin. */
export async function getPositionsByUserId(
  userId: string,
  params?: Omit<GetPositionsParams, 'userId'>
): Promise<Position[]> {
  return fetchPositionsForUser(userId, params?.status ? params : { status: 'all' })
}

export interface UpdatePositionSltpRequest {
  stop_loss?: string | null
  take_profit?: string | null
}

export async function updatePositionSltp(
  positionId: string,
  payload: UpdatePositionSltpRequest
): Promise<void> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    throw new Error('User not authenticated')
  }
  await http(`/v1/users/${userId}/positions/${positionId}/sltp`, {
    method: 'PUT',
    body: JSON.stringify({
      stopLoss: payload.stop_loss || null,
      takeProfit: payload.take_profit || null,
    }),
  })
}

export interface ClosePositionRequest {
  size?: string | null // Optional size to close (null = full close)
}

export interface ClosePositionResponse {
  success: boolean
  message: string
  position_id: string
}

export async function closePosition(
  positionId: string,
  payload?: ClosePositionRequest
): Promise<ClosePositionResponse> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    throw new Error('User not authenticated')
  }
  return await http<ClosePositionResponse>(`/v1/users/${userId}/positions/${positionId}/close`, {
    method: 'POST',
    body: JSON.stringify({
      size: payload?.size || null,
    }),
  })
}
