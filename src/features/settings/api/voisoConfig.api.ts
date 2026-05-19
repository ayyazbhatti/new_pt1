import { http } from '@/shared/api/http'

export interface VoisoConfigResponse {
  apiKeyConfigured: boolean
  storedApiKeyConfigured: boolean
  envApiKeyConfigured: boolean
  click2callUrl: string
  panelUrl: string
  enabled: boolean
}

export interface UpdateVoisoConfigPayload {
  /** Omit to keep unchanged; empty string removes the stored key; non-empty replaces it. */
  apiKey?: string
  click2callUrl: string
  panelUrl: string
  enabled: boolean
}

export async function getVoisoConfig(): Promise<VoisoConfigResponse> {
  return http<VoisoConfigResponse>('/api/admin/settings/voiso', { method: 'GET' })
}

export async function updateVoisoConfig(payload: UpdateVoisoConfigPayload): Promise<VoisoConfigResponse> {
  return http<VoisoConfigResponse>('/api/admin/settings/voiso', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
