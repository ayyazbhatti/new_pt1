/** Single Pay / Get tier: user pays X and gets account size Y */
export interface PayGetTier {
  id: string
  pay: number
  get: number
  favorite?: boolean
  popular?: boolean
}

export interface RetrySettings {
  planRetry: boolean
  discountType: 'custom' | 'fixed'
  discountAmount: number // percentage
  setToFixedPrice: boolean
  discountSourcePrice: 'original' | 'current'
  expirationDays: number
  totalRetriesByPurchase: number
}

export interface PhaseConditions {
  maxDailyLoss: number // e.g. -5
  maxOverallLoss: number // e.g. -10
  minTradingDays: number | null
  disableMinTradingDays: boolean
  challengeDuration: number
  unlimitedDays: boolean
  profitTarget: number
  noProfitTarget: boolean
  maxDailyProfit: number | null
  disableMaxDailyProfit: boolean
  promoCode: string
  challengeLeverage: string
}

export interface AddOnPayoutExpress {
  enabled: boolean
  days: number
  price: number
  setToFixedPrice: boolean
}

export interface AddOns {
  payoutExpress: AddOnPayoutExpress
  profitBooster: { enabled: boolean }
  holdOverWeekend: { enabled: boolean }
  doubleLeverage: { enabled: boolean }
}

export interface ChallengeKeeperSettings {
  keeperActive: boolean
  accountSizeLabel: string // e.g. '$25K'
  selectedConditionsByPhase: Record<string, string[]> // phaseId -> condition ids
}

export interface FundedPlan {
  id: string
  name: string
  payGetTiers: PayGetTier[]
  retry: RetrySettings
  phase01: PhaseConditions
  phase02: PhaseConditions
  phase03: PhaseConditions
  addOns: AddOns
  challengeKeeper: ChallengeKeeperSettings
  active: boolean
  createdAt?: string
}

export const DEFAULT_RETRY: RetrySettings = {
  planRetry: true,
  discountType: 'custom',
  discountAmount: 20,
  setToFixedPrice: false,
  discountSourcePrice: 'original',
  expirationDays: 7,
  totalRetriesByPurchase: 4,
}

export const DEFAULT_PHASE_CONDITIONS: PhaseConditions = {
  maxDailyLoss: -5,
  maxOverallLoss: -10,
  minTradingDays: 0,
  disableMinTradingDays: true,
  challengeDuration: 30,
  unlimitedDays: false,
  profitTarget: 10,
  noProfitTarget: false,
  maxDailyProfit: null,
  disableMaxDailyProfit: true,
  promoCode: 'none',
  challengeLeverage: 'system_default',
}

export const DEFAULT_ADDONS: AddOns = {
  payoutExpress: { enabled: true, days: 2, price: 20, setToFixedPrice: true },
  profitBooster: { enabled: false },
  holdOverWeekend: { enabled: false },
  doubleLeverage: { enabled: false },
}

export const DEFAULT_CHALLENGE_KEEPER: ChallengeKeeperSettings = {
  keeperActive: true,
  accountSizeLabel: '$25K',
  selectedConditionsByPhase: { phase01: ['max_daily_loss', 'max_overall_loss'], phase02: [], phase03: [] },
}

export const CONDITION_OPTIONS = [
  { id: 'max_daily_loss', label: 'Max Daily Loss' },
  { id: 'max_overall_loss', label: 'Max Overall Loss' },
  { id: 'profit_target', label: 'Profit Target' },
  { id: 'min_trading_days', label: 'Minimum Trading Days' },
  { id: 'challenge_duration', label: 'Challenge Duration' },
] as const
