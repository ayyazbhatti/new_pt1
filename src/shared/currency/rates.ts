import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { http } from '@/shared/api/http'
import type { FxRatesSnapshot } from './types'

const FX_RATES_QUERY_KEY = ['fx-rates'] as const

/** Fetch current FX rates. Falls back to a USD-only snapshot if the API fails. */
export async function fetchFxRates(): Promise<FxRatesSnapshot> {
  try {
    return await http<FxRatesSnapshot>('/api/fx-rates/current')
  } catch {
    return { rates: { USD: '1' }, fetchedAt: null, source: 'fallback', isStale: true }
  }
}

export function useFxRates(): UseQueryResult<FxRatesSnapshot> {
  return useQuery({
    queryKey: FX_RATES_QUERY_KEY,
    queryFn: fetchFxRates,
    // FX rates refresh hourly on the backend; refetch every 30 minutes on the client
    // so users see fresh rates roughly synchronized with the backend cache cycle.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Don't poll — let the staleTime + manual invalidation drive updates
  })
}

/** Returns the rates map directly, defaulting to USD-only if not yet loaded. */
export function useFxRatesMap(): Record<string, string> {
  const { data } = useFxRates()
  return data?.rates ?? { USD: '1' }
}
