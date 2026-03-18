import { http } from '@/shared/api/http'

export interface FinanceOverview {
  totalBalances: number
  pendingDeposits: number
  pendingWithdrawals: number
  netFeesToday: number
  depositsToday: {
    count: number
    amount: number
  }
  withdrawalsToday: {
    count: number
    amount: number
  }
}

export interface Transaction {
  id: string
  userId: string
  userEmail: string
  userFirstName?: string
  userLastName?: string
  type: 'deposit' | 'withdrawal' | 'adjustment' | 'fee' | 'rebate'
  amount: number
  currency: string
  fee: number
  netAmount: number
  method: 'card' | 'bank' | 'crypto' | 'manual'
  status: 'pending' | 'approved' | 'completed' | 'rejected' | 'failed' // 'completed' for backward compatibility
  reference: string
  methodDetails?: any
  adminNotes?: string
  rejectionReason?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface Wallet {
  id: string
  userId: string
  userEmail: string
  userFirstName?: string
  userLastName?: string
  walletType: 'spot' | 'margin' | 'funding'
  currency: string
  availableBalance: number
  lockedBalance: number
  equity: number
  updatedAt: string
}

export interface ListTransactionsParams {
  search?: string
  type?: string
  status?: string
  currency?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export interface PaginatedTransactions {
  items: Transaction[]
  total: number
}

export interface ListWalletsParams {
  search?: string
  walletType?: string
  currency?: string
  balanceMin?: number
  balanceMax?: number
  page?: number
  pageSize?: number
}

export async function fetchFinanceOverview(): Promise<FinanceOverview> {
  const response = await http<any>('/api/admin/finance/overview')
  // Transform snake_case to camelCase
  return {
    totalBalances: Number(response.total_balances ?? response.totalBalances ?? 0),
    pendingDeposits: response.pending_deposits ?? response.pendingDeposits ?? 0,
    pendingWithdrawals: response.pending_withdrawals ?? response.pendingWithdrawals ?? 0,
    netFeesToday: Number(response.net_fees_today ?? response.netFeesToday ?? 0),
    depositsToday: {
      count: response.deposits_today?.count ?? response.depositsToday?.count ?? 0,
      amount: Number(response.deposits_today?.amount ?? response.depositsToday?.amount ?? 0),
    },
    withdrawalsToday: {
      count: response.withdrawals_today?.count ?? response.withdrawalsToday?.count ?? 0,
      amount: Number(response.withdrawals_today?.amount ?? response.withdrawalsToday?.amount ?? 0),
    },
  }
}

function mapTransactionFromApi(tx: any): Transaction {
  return {
    id: tx.id,
    userId: tx.user_id ?? tx.userId,
    userEmail: tx.user_email ?? tx.userEmail,
    userFirstName: tx.user_first_name ?? tx.userFirstName,
    userLastName: tx.user_last_name ?? tx.userLastName,
    type: tx.type,
    amount: Number(tx.amount ?? 0),
    currency: tx.currency,
    fee: Number(tx.fee ?? 0),
    netAmount: Number(tx.net_amount ?? tx.netAmount ?? 0),
    method: tx.method,
    status: tx.status,
    reference: tx.reference,
    methodDetails: tx.method_details ?? tx.methodDetails,
    adminNotes: tx.admin_notes ?? tx.adminNotes,
    rejectionReason: tx.rejection_reason ?? tx.rejectionReason,
    createdAt: tx.created_at ?? tx.createdAt ?? '',
    updatedAt: tx.updated_at ?? tx.updatedAt ?? '',
    completedAt: tx.completed_at ?? tx.completedAt,
  }
}

export async function fetchTransactions(params?: ListTransactionsParams): Promise<PaginatedTransactions> {
  const queryParams = new URLSearchParams()
  if (params?.search) queryParams.append('search', params.search)
  if (params?.type && params.type !== 'all') queryParams.append('type', params.type)
  if (params?.status && params.status !== 'all') queryParams.append('status', params.status)
  if (params?.currency && params.currency !== 'all') queryParams.append('currency', params.currency)
  if (params?.dateFrom) queryParams.append('date_from', params.dateFrom)
  if (params?.dateTo) queryParams.append('date_to', params.dateTo)
  const page = params?.page ?? 1
  const pageSize = params?.pageSize ?? 20
  queryParams.append('page', page.toString())
  queryParams.append('page_size', pageSize.toString())

  const url = `/api/admin/finance/transactions?${queryParams.toString()}`
  const response = await http<{ items?: any[]; total?: number }>(url)
  if (!response) return { items: [], total: 0 }

  const rawItems = response.items ?? response
  const items = Array.isArray(rawItems) ? rawItems.map(mapTransactionFromApi) : []
  const total = response.total ?? items.length

  return { items, total }
}

export async function fetchWallets(params?: ListWalletsParams): Promise<Wallet[]> {
  const queryParams = new URLSearchParams()
  if (params?.search) queryParams.append('search', params.search)
  if (params?.walletType && params.walletType !== 'all') queryParams.append('wallet_type', params.walletType)
  if (params?.currency && params.currency !== 'all') queryParams.append('currency', params.currency)
  if (params?.balanceMin !== undefined) queryParams.append('balance_min', params.balanceMin.toString())
  if (params?.balanceMax !== undefined) queryParams.append('balance_max', params.balanceMax.toString())
  if (params?.page) queryParams.append('page', params.page.toString())
  if (params?.pageSize) queryParams.append('page_size', params.pageSize.toString())

  const url = `/api/admin/finance/wallets${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
  const response = await http<Wallet[]>(url)
  return response || []
}

export interface ApproveTransactionResponse {
  status: string
  message: string
}

export interface RejectTransactionRequest {
  reason?: string
  note?: string
}

export async function approveTransaction(transactionId: string): Promise<ApproveTransactionResponse> {
  return http<ApproveTransactionResponse>(`/api/admin/finance/transactions/${transactionId}/approve`, {
    method: 'POST',
  })
}

export async function rejectTransaction(transactionId: string, reason?: string, note?: string): Promise<ApproveTransactionResponse> {
  return http<ApproveTransactionResponse>(`/api/admin/finance/transactions/${transactionId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason, note }),
  })
}

/** Admin direct deposit: create an approved deposit for a user in one step. POST /api/admin/deposits/direct */
export interface DirectDepositRequest {
  userId: string
  amount: number
  note?: string
}

export interface DirectDepositResponse {
  transactionId: string
  status: string
  message: string
}

export async function createDirectDeposit(payload: DirectDepositRequest): Promise<DirectDepositResponse> {
  return http<DirectDepositResponse>('/api/admin/deposits/direct', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

