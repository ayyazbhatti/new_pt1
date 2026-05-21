import { useContext, useCallback } from 'react'
import { CurrencyContext } from './context'
import { useFxRatesMap } from './rates'
import * as fmt from './format'
import type { MoneyInput } from './format'
import type { CurrencyCode, ResolvedCurrency } from './types'

export function useEffectiveCurrency(): ResolvedCurrency {
  return useContext(CurrencyContext)
}

/** Format a USD-denominated amount in the user's effective currency. */
export function useFormatFromUsd() {
  const code = useEffectiveCurrency().code
  const rates = useFxRatesMap()
  return useCallback(
    (amount: MoneyInput) => fmt.formatFromUsd(amount, code, rates),
    [code, rates],
  )
}

/** Signed variant for PnL — adds +/- prefix. */
export function useFormatSignedFromUsd() {
  const code = useEffectiveCurrency().code
  const rates = useFxRatesMap()
  return useCallback(
    (amount: MoneyInput) => fmt.formatSignedFromUsd(amount, code, rates),
    [code, rates],
  )
}

/** Format an amount that's already in some specific currency, no conversion. */
export function useFormatAmount() {
  return useCallback(
    (amount: MoneyInput, currency: CurrencyCode) => fmt.formatAmount(amount, currency),
    [],
  )
}

/** Convert + format from any source currency to user's effective currency. */
export function useFormatConverted() {
  const code = useEffectiveCurrency().code
  const rates = useFxRatesMap()
  return useCallback(
    (amount: MoneyInput, fromCurrency: CurrencyCode) =>
      fmt.formatConverted(amount, fromCurrency, code, rates),
    [code, rates],
  )
}

/** Returns just the effective currency code string — useful for labels/symbols. */
export function useCurrencyCode(): string {
  return useEffectiveCurrency().code
}

/** Returns the currency symbol/prefix used by formatting, e.g. '$', '€', 'Rs', '¥'. */
export function useCurrencySymbol(): string {
  const code = useEffectiveCurrency().code
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? code
  } catch {
    return code
  }
}
