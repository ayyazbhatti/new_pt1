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
  status: 'OPEN' | 'CLOSED'
  opened_at: number
  updated_at: number
  closed_at?: number // Timestamp when position was closed
}

export interface PositionsResponse {
  positions: Position[]
}

export async function getPositions(): Promise<Position[]> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) {
    throw new Error('User not authenticated')
  }
  const response = await http<PositionsResponse>(`/v1/users/${userId}/positions`)
  return response.positions || []
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

