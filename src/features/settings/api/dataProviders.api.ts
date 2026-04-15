import { http } from '@/shared/api/http'

export type DataProviderType = 'binance'

export interface DataProviderEntry {
  id: string
  type: DataProviderType
  enabled: boolean
  displayName: string
  wsUrl?: string | null
  symbols: string[]
}

export interface DataProvidersConfig {
  version: number
  providers: DataProviderEntry[]
}

export interface SaveDataProvidersResponse {
  success: boolean
  config: DataProvidersConfig
  message?: string
}

export async function getDataProvidersConfig(): Promise<DataProvidersConfig> {
  return http<DataProvidersConfig>('/api/admin/settings/data-providers', { method: 'GET' })
}

export async function updateDataProvidersConfig(
  payload: DataProvidersConfig
): Promise<SaveDataProvidersResponse> {
  return http<SaveDataProvidersResponse>('/api/admin/settings/data-providers', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export interface TestDataProviderWsResult {
  ok: boolean
  detail?: string
  error?: string
}

/** Server opens the multiplex WebSocket, SUBSCRIBE btcusdt@bookTicker, checks for a ticker message. */
export async function testDataProviderWsUrl(
  wsUrl: string | null | undefined
): Promise<TestDataProviderWsResult> {
  const trimmed = wsUrl?.trim() ?? ''
  return http<TestDataProviderWsResult>('/api/admin/settings/data-providers/test-ws', {
    method: 'POST',
    body: JSON.stringify({ wsUrl: trimmed === '' ? null : trimmed }),
  })
}
