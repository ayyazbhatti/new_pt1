import { createContext, useMemo, type ReactNode } from 'react'
import { resolveEffectiveCurrency } from './resolve'
import type { CurrencySource, ResolvedCurrency } from './types'

export const CurrencyContext = createContext<ResolvedCurrency>({
  code: 'USD',
  origin: 'fallback',
})

interface ProviderProps {
  source: CurrencySource
  children: ReactNode
}

export function CurrencyProvider({ source, children }: ProviderProps) {
  const value = useMemo(
    () => resolveEffectiveCurrency(source),
    [source.userCurrency, source.groupCurrency, source.platformCurrency],
  )
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

/** Override for admin views drilling into a specific user's data. */
export function CurrencyOverrideProvider({ source, children }: ProviderProps) {
  const value = useMemo(
    () => resolveEffectiveCurrency(source),
    [source.userCurrency, source.groupCurrency, source.platformCurrency],
  )
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}
