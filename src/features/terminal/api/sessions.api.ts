import { http } from '@/shared/api/http'

/** Matches `SessionStatus` JSON from auth-service (`#[serde(rename_all = "camelCase")]`). */
export interface SessionStatus {
  isOpen: boolean
  templateId: string
  templateName: string
  timezone: string
  is24_7: boolean
  nextOpenAt: string | null
  nextCloseAt: string | null
}

export async function fetchSessionStatus(symbolCode: string): Promise<SessionStatus> {
  return http<SessionStatus>(`/api/sessions/status?symbol=${encodeURIComponent(symbolCode)}`)
}

export async function fetchSessionStatusBatch(symbolCodes: string[]): Promise<Record<string, SessionStatus>> {
  if (symbolCodes.length === 0) return {}
  const csv = symbolCodes.join(',')
  return http<Record<string, SessionStatus>>(
    `/api/sessions/status/batch?symbols=${encodeURIComponent(csv)}`
  )
}
