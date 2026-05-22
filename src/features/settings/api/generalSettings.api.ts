import { http } from '@/shared/api/http'

export interface GeneralSettings {
  siteName: string
  timezone: string
  currency: string
  /** Platform default max slippage for market orders (basis points). 50 = 0.5%. */
  defaultSlippageBps: number
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  return http<GeneralSettings>('/api/admin/settings/general', { method: 'GET' })
}

export async function updateGeneralSettings(data: GeneralSettings): Promise<GeneralSettings> {
  return http<GeneralSettings>('/api/admin/settings/general', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}
