import { http } from '@/shared/api/http'

export const AI_REPORT_SECTIONS = [
  'profile',
  'trading_performance',
  'open_positions',
  'closed_trades',
  'financial_activity',
  'risk_profile',
  'kyc',
  'engagement',
  'affiliate',
  'admin_activity',
] as const

export type AiReportSection = (typeof AI_REPORT_SECTIONS)[number]

export type AiReportStatus = 'pending' | 'streaming' | 'completed' | 'failed'

export interface AiReportDto {
  id: string
  subjectUserId: string
  generatedByUserId: string | null
  sections: string[]
  focusPrompt: string | null
  content: string
  model: string
  tokensIn: number | null
  tokensOut: number | null
  status: AiReportStatus
  error: string | null
  bulkBatchId: string | null
  createdAt: string
  completedAt: string | null
}

export interface GenerateAiReportsResult {
  bulkBatchId: string | null
  reportIds: string[]
  startedAt: string
}

export interface ListAiReportsParams {
  subjectUserId?: string
  bulkBatchId?: string
  limit?: number
  cursor?: string
}

export interface ListAiReportsResult {
  items: AiReportDto[]
  nextCursor: string | null
}

function normalizeReport(d: AiReportDto): AiReportDto {
  const sections = Array.isArray(d.sections) ? d.sections : []
  return { ...d, sections }
}

export async function generateAiReports(payload: {
  subjectUserIds: string[]
  sections: string[]
  focusPrompt?: string
  idempotencyKey: string
}): Promise<GenerateAiReportsResult> {
  return http<GenerateAiReportsResult>('/api/admin/ai/reports', {
    method: 'POST',
    body: JSON.stringify({
      subjectUserIds: payload.subjectUserIds,
      sections: payload.sections,
      focusPrompt: payload.focusPrompt?.trim() || undefined,
      idempotencyKey: payload.idempotencyKey,
    }),
  })
}

export async function getAiReport(id: string): Promise<AiReportDto> {
  const data = await http<AiReportDto>(`/api/admin/ai/reports/${id}`)
  return normalizeReport(data)
}

export async function listAiReports(params: ListAiReportsParams = {}): Promise<ListAiReportsResult> {
  const q = new URLSearchParams()
  if (params.subjectUserId) q.set('subjectUserId', params.subjectUserId)
  if (params.bulkBatchId) q.set('bulkBatchId', params.bulkBatchId)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.cursor) q.set('cursor', params.cursor)
  const query = q.toString()
  const data = await http<ListAiReportsResult>(
    `/api/admin/ai/reports${query ? `?${query}` : ''}`,
  )
  return {
    ...data,
    items: (data.items ?? []).map(normalizeReport),
  }
}

export async function getAiReportBatch(batchId: string): Promise<AiReportDto[]> {
  const data = await http<{ items?: AiReportDto[] } | AiReportDto[]>(
    `/api/admin/ai/reports/batch/${batchId}`,
  )
  const rows = Array.isArray(data) ? data : (data.items ?? [])
  return rows.map(normalizeReport)
}

export async function deleteAiReport(id: string): Promise<void> {
  await http<void>(`/api/admin/ai/reports/${id}`, { method: 'DELETE' })
}
