import { http } from '@/shared/api/http'
import { CreateDepositRequestInput, CreateWithdrawalRequestInput } from './types'

export interface CreateDepositRequestResponse {
  requestId: string // This is actually transaction_id now, kept for backward compatibility
  status: string
  message?: string
}

export interface CreateWithdrawalRequestResponse {
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

export interface AccountSummaryResponse {
  userId: string
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  marginLevel: string
  realizedPnl: number
  unrealizedPnl: number
  updatedAt: string
}

export async function fetchAccountSummary(): Promise<AccountSummaryResponse> {
  return http<AccountSummaryResponse>('/api/account/summary')
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

export async function createWithdrawalRequest(
  input: CreateWithdrawalRequestInput
): Promise<CreateWithdrawalRequestResponse> {
  return http<CreateWithdrawalRequestResponse>('/api/withdrawals/request', {
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
