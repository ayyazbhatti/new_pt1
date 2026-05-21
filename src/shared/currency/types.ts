/** ISO 4217 currency code, e.g. 'USD', 'EUR', 'PKR' */
export type CurrencyCode = string

export interface CurrencySource {
  /** Per-user override, highest priority */
  userCurrency?: CurrencyCode | null
  /** Group-level default */
  groupCurrency?: CurrencyCode | null
  /** Platform-wide default */
  platformCurrency?: CurrencyCode | null
}

export type CurrencyOrigin = 'user' | 'group' | 'platform' | 'fallback'

export interface ResolvedCurrency {
  code: CurrencyCode
  origin: CurrencyOrigin
}

/** Snapshot of FX rates, mirroring the backend FxRatesSnapshot shape */
export interface FxRatesSnapshot {
  /** Map of currency code → rate string (1 USD = N units of this currency).
   *  Values come in as strings from the backend (Decimal-serialized). */
  rates: Record<string, string>
  fetchedAt: string | null
  source: string
  isStale: boolean
}
