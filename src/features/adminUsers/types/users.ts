export type UserStatus = 'active' | 'disabled' | 'suspended'
export type KYCStatus = 'none' | 'pending' | 'verified' | 'rejected'
export type RiskFlag = 'normal' | 'high' | 'review'
export type AccountType = 'hedging' | 'netting'
export type WalletType = 'spot' | 'margin' | 'funding'
export type Currency = 'USD' | 'EUR' | 'BTC' | 'USDT'
export type DocStatus = 'pending' | 'approved' | 'rejected'

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  country: string
  group: string
  groupName: string
  accountType: AccountType
  openPositionsCount: number
  balance: number
  marginLevel: number
  status: UserStatus
  kycStatus: KYCStatus
  riskFlag: RiskFlag
  createdAt: string
  lastLogin?: string
  affiliateCode?: string
  leverageLimitMin: number
  leverageLimitMax: number
  currentExposure: number
  openPositions: number
  ordersCount: number
  priceStreamProfile: string
  tradingEnabled: boolean
  closeOnlyMode: boolean
  withdrawalsEnabled: boolean
  depositsEnabled: boolean
  maxLeverageCap: number
  maxPositionSize: number
  maxDailyLoss: number
}

export interface UserWallet {
  id: string
  walletType: WalletType
  currency: Currency
  available: number
  locked: number
  equity: number
}

export interface KYCDocument {
  id: string
  type: 'id' | 'address' | 'selfie'
  name: string
  status: DocStatus
  uploadedAt: string
}

export interface ActivityLog {
  id: string
  time: string
  action: string
  admin: string
  details: string
}

