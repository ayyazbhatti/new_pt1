/** Single row for bulk user creation (legacy table-based UI) */
export interface BulkUserRow {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  country: string
  groupId: string
  status: 'active' | 'disabled'
  minLeverage: number
  maxLeverage: number
}

/** Config for bulk user creation (number + prefixes + shared password) */
export interface BulkUserCreationConfig {
  count: number
  usernamePrefix: string
  emailDomain: string
  password: string
  firstNamePrefix: string
  lastName: string
  startingNumber: number
  groupId: string
  accountMode: 'netting' | 'hedging'
  initialBalanceEnabled: boolean
  initialBalanceAmount: number
  initialBalanceFee: number
  initialBalanceReference: string
}

/** Single result row after bulk run */
export interface BulkUserCreationResult {
  username: string
  email: string
  success: boolean
  userId?: string
  accountId?: string
  error?: string
}
