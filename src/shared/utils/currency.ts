/**
 * Currency display helpers (legacy non-React entry point).
 * Prefer `@/shared/currency` hooks in React components for effective display currency.
 */
import { formatAmount as fmtAmount } from '@/shared/currency/format'
import type { MoneyInput } from '@/shared/currency/format'
import { useFormatAmount, useFormatFromUsd, useFormatSignedFromUsd } from '@/shared/currency/hooks'

/**
 * Non-React legacy export. Formats `value` in the given currency code (no FX conversion).
 * @deprecated For React components, use `useFormatFromUsd`, `useFormatConverted`, or `useFormatAmount` from `@/shared/currency`.
 */
export function formatCurrency(value: MoneyInput, currency: string = 'USD'): string {
  return fmtAmount(value, currency)
}

export { useFormatFromUsd, useFormatSignedFromUsd, useFormatAmount }
