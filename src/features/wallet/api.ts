import { http } from '@/shared/api/http'
import { CreateDepositRequestInput } from './types'

export interface CreateDepositRequestResponse {
  requestId: string
  status: string
  message?: string
}

export interface WalletBalanceResponse {
  userId: string
  currency: string
  available: number
  locked: number
  equity: number
  marginUsed: number
  freeMargin: number
  updatedAt: string
}

export async function createDepositRequest(
  input: CreateDepositRequestInput
): Promise<CreateDepositRequestResponse> {
  return http<CreateDepositRequestResponse>('/api/deposits/request', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      note: input.note,
    }),
  })
}

export async function fetchBalance(): Promise<WalletBalanceResponse> {
  return http<WalletBalanceResponse>('/api/wallet/balance')
}
