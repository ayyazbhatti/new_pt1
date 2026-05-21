import { http } from '@/shared/api/http'

export interface FxRatesSnapshot {
  rates: Record<string, string>
  fetchedAt: string | null
  source: string
  isStale: boolean
}

export async function getFxRates(): Promise<FxRatesSnapshot> {
  return http<FxRatesSnapshot>('/api/admin/fx-rates')
}

export async function refreshFxRates(): Promise<FxRatesSnapshot> {
  return http<FxRatesSnapshot>('/api/admin/fx-rates/refresh', { method: 'POST' })
}
