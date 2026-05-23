import type { CurrencyCode, FxRatesSnapshot } from './types'

export type MoneyInput = number | string | null | undefined

function toNumber(input: MoneyInput): number | null {
  if (input == null || input === '') return null
  const n = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(n) ? n : null
}

/** Get decimal places appropriate for a currency (JPY = 0, USD = 2, BTC = 8, etc.) */
export function getCurrencyDecimals(currency: CurrencyCode): number {
  // Crypto-like — override Intl which doesn't recognize these as ISO 4217
  const upper = currency.toUpperCase()
  if (upper === 'BTC' || upper === 'ETH') return 8
  if (upper === 'USDT' || upper === 'USDC') return 2
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: upper,
    }).resolvedOptions()
    return parts.maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** Format a raw amount in a specific currency, with the right decimal precision. */
export function formatAmount(amount: MoneyInput, currency: CurrencyCode): string {
  const n = toNumber(amount)
  if (n == null) return '—'
  const upper = currency.toUpperCase()
  // Bypass Intl for non-ISO codes
  if (upper === 'BTC' || upper === 'ETH' || upper === 'USDT' || upper === 'USDC') {
    return `${n.toFixed(getCurrencyDecimals(upper))} ${upper}`
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: upper,
      minimumFractionDigits: getCurrencyDecimals(upper),
      maximumFractionDigits: getCurrencyDecimals(upper),
    }).format(n)
  } catch {
    return `${n.toFixed(2)} ${upper}`
  }
}

/** Convert an amount from `from` to `to` using a rates snapshot. */
export function convertAmount(
  amount: MoneyInput,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: FxRatesSnapshot['rates'],
): number | null {
  const n = toNumber(amount)
  if (n == null) return null
  const fromUpper = from.toUpperCase()
  const toUpper = to.toUpperCase()
  if (fromUpper === toUpper) return n
  // Treat USDT/USDC as USD 1:1
  const normalize = (c: string) => (c === 'USDT' || c === 'USDC' ? 'USD' : c)
  const fromN = normalize(fromUpper)
  const toN = normalize(toUpper)
  if (fromN === toN) return n

  const rateFrom = fromN === 'USD' ? 1 : Number(rates[fromN])
  const rateTo = toN === 'USD' ? 1 : Number(rates[toN])
  if (!Number.isFinite(rateFrom) || !Number.isFinite(rateTo) || rateFrom === 0) {
    return null
  }
  // amount * (rate_to / rate_from)
  return (n * rateTo) / rateFrom
}

/** Convert USD amount → target currency, formatted. The most common call. */
export function formatFromUsd(
  usdAmount: MoneyInput,
  targetCurrency: CurrencyCode,
  rates: FxRatesSnapshot['rates'],
): string {
  const converted = convertAmount(usdAmount, 'USD', targetCurrency, rates)
  if (converted == null) return '—'
  return formatAmount(converted, targetCurrency)
}

/** Full conversion + format from any source to any target. */
export function formatConverted(
  amount: MoneyInput,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: FxRatesSnapshot['rates'],
): string {
  const converted = convertAmount(amount, fromCurrency, toCurrency, rates)
  if (converted == null) return '—'
  return formatAmount(converted, toCurrency)
}

/** Format with a +/- sign for PnL display. Negative numbers get a `-`, positive get `+`. */
export function formatSignedFromUsd(
  usdAmount: MoneyInput,
  targetCurrency: CurrencyCode,
  rates: FxRatesSnapshot['rates'],
): string {
  const n = toNumber(usdAmount)
  if (n == null) return '—'
  const formatted = formatFromUsd(Math.abs(n), targetCurrency, rates)
  if (formatted === '—') return '—'
  return n >= 0 ? `+${formatted}` : `-${formatted}`
}

/** Signed +/- display for an amount already denominated in `currency` (no FX conversion). */
export function formatSignedAmount(amount: MoneyInput, currency: CurrencyCode): string {
  const n = toNumber(amount)
  if (n == null) return '—'
  const formatted = formatAmount(Math.abs(n), currency)
  if (formatted === '—') return '—'
  return n >= 0 ? `+${formatted}` : `-${formatted}`
}

/** Convert from `fromCurrency` to `toCurrency`, then format with +/- for P&L-style rows. */
export function formatSignedConverted(
  amount: MoneyInput,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: FxRatesSnapshot['rates'],
): string {
  const n = toNumber(amount)
  if (n == null) return '—'
  const formatted = formatConverted(Math.abs(n), fromCurrency, toCurrency, rates)
  if (formatted === '—') return '—'
  return n >= 0 ? `+${formatted}` : `-${formatted}`
}
