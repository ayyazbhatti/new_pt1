import { createContext, useMemo, type ReactNode } from 'react'
import { resolveEffectiveTimezone } from './resolve'
import type { ResolvedTimezone, TimezoneSource } from './types'

export const TimezoneContext = createContext<ResolvedTimezone>({
  iana: 'UTC',
  origin: 'fallback',
})

interface ProviderProps {
  source: TimezoneSource
  children: ReactNode
}

export function TimezoneProvider({ source, children }: ProviderProps) {
  const value = useMemo(
    () => resolveEffectiveTimezone(source),
    [source.userTimezone, source.groupTimezone, source.platformTimezone],
  )
  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>
}

/**
 * For admin pages that need to show data in a DIFFERENT user's timezone
 * (e.g. UserDetailsModal viewing trader X). Wrap subtree in this to override.
 */
export function TimezoneOverrideProvider({ source, children }: ProviderProps) {
  const value = useMemo(
    () => resolveEffectiveTimezone(source),
    [source.userTimezone, source.groupTimezone, source.platformTimezone],
  )
  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>
}
