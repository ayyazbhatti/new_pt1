import { http } from '@/shared/api/http'
import { useAuthStore } from '@/shared/store/auth.store'

export interface Position {
  id: string
  user_id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  size: string
  entry_price: string
  avg_price: string
  sl?: string
  tp?: string
  leverage: string
  margin: string
  unrealized_pnl: string
  realized_pnl: string
  status: 'OPEN' | 'CLOSED'
  opened_at: number
  updated_at: number
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

