import { http } from '@/shared/api/http'

export interface TerminalPreferences {
  chartShowAskPrice: boolean
  chartShowPositionMarker: boolean
  chartShowClosedPositionMarker: boolean
  enableLiquidationEmail: boolean
  enableSlTpEmail: boolean
  favouriteSymbolIds: string[]
}

export interface TerminalPreferencesResponse {
  preferences: TerminalPreferences
}

export async function getTerminalPreferences(): Promise<TerminalPreferencesResponse> {
  return http<TerminalPreferencesResponse>('/api/user/terminal-preferences')
}

export async function updateTerminalPreferences(
  preferences: Partial<TerminalPreferences>
): Promise<TerminalPreferencesResponse> {
  return http<TerminalPreferencesResponse>('/api/user/terminal-preferences', {
    method: 'PUT',
    body: JSON.stringify({ preferences }),
  })
}
