import { http } from '@/shared/api/http'
import { DepositRequest } from './types'

export interface ListDepositsResponse {
  items: DepositRequest[]
  total: number
  page: number
  pageSize: number
}

export async function fetchPendingDeposits(): Promise<DepositRequest[]> {
  // Backend returns array directly, not wrapped in an object
  const response = await http<DepositRequest[]>('/api/admin/deposits?status=pending')
  return response || []
}

export async function approveDepositRequest(requestId: string): Promise<void> {
  await http(`/api/admin/deposits/${requestId}/approve`, {
    method: 'POST',
  })
}
