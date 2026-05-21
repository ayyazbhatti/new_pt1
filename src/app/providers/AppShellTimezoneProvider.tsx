import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TimezoneProvider } from '@/shared/datetime'
import { CurrencyProvider } from '@/shared/currency'
import { me } from '@/shared/api/auth.api'
import { profileQueryKey } from '@/features/userPanel/hooks/useProfile'
import { useAuthStore } from '@/shared/store/auth.store'

/**
 * Feeds {@link TimezoneProvider} and {@link CurrencyProvider} from GET /api/auth/me (same query as `useProfile`).
 * When logged out, still renders children with UTC / USD fallbacks inside the providers.
 */
export function AppShellTimezoneProvider({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const persistRehydrated = useAuthStore((s) => s.persistRehydrated)
  const { data } = useQuery({
    queryKey: profileQueryKey,
    queryFn: me,
    enabled: Boolean(accessToken && persistRehydrated),
    staleTime: 60_000,
  })

  return (
    <TimezoneProvider
      source={{
        userTimezone: data?.timezone ?? null,
        groupTimezone: data?.groupTimezone ?? null,
        platformTimezone: undefined,
      }}
    >
      <CurrencyProvider
        source={{
          userCurrency: data?.displayCurrency ?? null,
          groupCurrency: data?.groupDisplayCurrency ?? null,
          platformCurrency: data?.platformDisplayCurrency ?? null,
        }}
      >
        {children}
      </CurrencyProvider>
    </TimezoneProvider>
  )
}
