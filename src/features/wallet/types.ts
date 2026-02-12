export interface DepositRequest {
  requestId: string
  userId: string
  amount: number
  currency: 'USD'
  note?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  approvedAt?: string
  rejectedAt?: string
}

export interface CreateDepositRequestInput {
  amount: number
  note?: string
}

