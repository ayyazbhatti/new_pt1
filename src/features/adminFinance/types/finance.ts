export type TransactionType = 'deposit' | 'withdrawal' | 'adjustment' | 'fee' | 'rebate' | 'swap'
export type TransactionStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'completed'
export type TransactionMethod = 'card' | 'bank' | 'crypto' | 'manual'
export type Currency = 'USD' | 'EUR' | 'BTC' | 'USDT'
export type WalletType = 'spot' | 'margin' | 'funding'
export type AdjustmentType = 'credit' | 'debit'
export type ReasonCategory = 'correction' | 'bonus' | 'fee_refund' | 'chargeback' | 'other'

export interface User {
  id: string
  email: string
  name?: string
  firstName?: string
  lastName?: string
}

export interface Transaction {
  id: string
  user: User
  /** Postgres `transaction_type` (includes margin_lock, pnl_credit, etc.) */
  type: string
  amount: number
  currency: Currency
  method: TransactionMethod
  fee: number
  netAmount: number
  status: TransactionStatus
  createdAt: string
  updatedAt?: string
  reference: string
  methodDetails?: {
    // Bank
    iban?: string
    account?: string
    bankName?: string
    // Crypto
    network?: string
    address?: string
    txHash?: string
    // Card
    provider?: string
    maskedCard?: string
  }
  adminNotes?: string
  rejectionReason?: string
}

export interface Wallet {
  id: string
  userId: string
  userEmail: string
  walletType: WalletType
  currency: Currency
  available: number
  locked: number
  equity?: number
  updatedAt: string
}

export interface LedgerEntry {
  id: string
  walletId: string
  time: string
  type: string
  delta: number
  balanceAfter: number
  ref: string
}

