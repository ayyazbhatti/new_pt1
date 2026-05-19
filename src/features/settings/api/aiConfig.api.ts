import { http } from '@/shared/api/http'

export interface AiConfigDto {
  provider: string
  model: string
  apiKeyConfigured: boolean
  storedApiKeyConfigured: boolean
  envApiKeyConfigured: boolean
  systemPrompt: string | null
  enabled: boolean
  maxTokensPerMessage: number
  dailyTokenCapPerUser: number
  rateLimitPerMinute: number
  includeUserContext: boolean
  topicGuardEnabled: boolean
  classifierModel: string
}

export interface UpdateAiConfigPayload {
  /** Omit to keep unchanged; empty string removes the stored key; non-empty replaces it. */
  apiKey?: string
  clearApiKey?: boolean
  provider?: string
  model?: string
  systemPrompt?: string | null
  enabled?: boolean
  maxTokensPerMessage?: number
  dailyTokenCapPerUser?: number
  rateLimitPerMinute?: number
  includeUserContext?: boolean
  topicGuardEnabled?: boolean
  classifierModel?: string
}

export interface TestAiConfigResponse {
  ok: boolean
  reply?: string
  error?: string
}

export async function getAiConfig(): Promise<AiConfigDto> {
  return http<AiConfigDto>('/api/admin/settings/ai', { method: 'GET' })
}

export async function updateAiConfig(payload: UpdateAiConfigPayload): Promise<AiConfigDto> {
  return http<AiConfigDto>('/api/admin/settings/ai', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function testAiConfig(payload?: { message?: string }): Promise<TestAiConfigResponse> {
  return http<TestAiConfigResponse>('/api/admin/settings/ai/test', {
    method: 'POST',
    body: JSON.stringify(payload ?? { message: 'What is leverage?' }),
  })
}
