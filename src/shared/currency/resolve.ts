import type { CurrencyCode, CurrencySource, ResolvedCurrency } from './types'

const FALLBACK_CURRENCY: CurrencyCode = 'USD'

const EXTRA_STABLE_CODES = new Set(['USDT', 'USDC'])

/** Validate by attempting Intl.NumberFormat with style: currency */
export function isValidCurrencyCode(code: string | null | undefined): code is CurrencyCode {
  if (!code || typeof code !== 'string') return false
  if (EXTRA_STABLE_CODES.has(code)) return true
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    return true
  } catch {
    return false
  }
}

export function resolveEffectiveCurrency(source: CurrencySource): ResolvedCurrency {
  if (isValidCurrencyCode(source.userCurrency)) {
    return { code: source.userCurrency, origin: 'user' }
  }
  if (isValidCurrencyCode(source.groupCurrency)) {
    return { code: source.groupCurrency, origin: 'group' }
  }
  if (isValidCurrencyCode(source.platformCurrency)) {
    return { code: source.platformCurrency, origin: 'platform' }
  }
  return { code: FALLBACK_CURRENCY, origin: 'fallback' }
}
