import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { AiReportStreamPayload } from '@/shared/ws/wsEvents'
import type { AiReportStatus } from '../api/aiReports.api'

export type ReportStreamStatus = AiReportStatus

export interface ReportStreamState {
  text: string
  status: ReportStreamStatus
  error: string | null
  startedAtMs: number | null
  completedAtMs: number | null
}

function emptyStream(status: ReportStreamStatus = 'pending'): ReportStreamState {
  return {
    text: '',
    status,
    error: null,
    startedAtMs: null,
    completedAtMs: null,
  }
}

function normalizePayload(raw: unknown): AiReportStreamPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const type = o.type
  if (typeof type !== 'string') return null

  const reportId = (o.reportId ?? o.report_id) as string | undefined
  const bulkBatchId = (o.bulkBatchId ?? o.bulk_batch_id) as string | null | undefined
  const subjectUserId = (o.subjectUserId ?? o.subject_user_id) as string | undefined
  const text = o.text as string | undefined
  const message = (o.message as string | undefined) ?? (o.error as string | undefined)
  const completed = o.completed as number | undefined
  const total = o.total as number | undefined

  switch (type) {
    case 'started':
      if (!reportId) return null
      return { type: 'started', reportId, subjectUserId: subjectUserId ?? '', bulkBatchId }
    case 'delta':
      if (!reportId) return null
      return { type: 'delta', reportId, text: text ?? '' }
    case 'done':
      if (!reportId) return null
      return { type: 'done', reportId, bulkBatchId }
    case 'error':
      if (!reportId) return null
      return { type: 'error', reportId, message: message ?? 'Report generation failed', bulkBatchId }
    case 'batch_progress':
      if (!bulkBatchId || completed == null || total == null) return null
      return { type: 'batch_progress', bulkBatchId, completed, total }
    default:
      return null
  }
}

export interface BatchProgressState {
  completed: number
  total: number
}

interface AiReportsStoreState {
  streams: Record<string, ReportStreamState>
  batchProgress: Record<string, BatchProgressState>
  initStream: (reportId: string, status?: ReportStreamStatus) => void
  clearStream: (reportId: string) => void
  applyStreamEvent: (reportId: string, payload: AiReportStreamPayload) => void
  setBatchProgress: (bulkBatchId: string, completed: number, total: number) => void
  handleWsPayload: (raw: unknown) => void
}

export const useAiReportsStore = create<AiReportsStoreState>((set, get) => ({
  streams: {},
  batchProgress: {},

  initStream: (reportId, status = 'pending') =>
    set((s) => ({
      streams: {
        ...s.streams,
        [reportId]: emptyStream(status),
      },
    })),

  clearStream: (reportId) =>
    set((s) => {
      const next = { ...s.streams }
      delete next[reportId]
      return { streams: next }
    }),

  applyStreamEvent: (reportId, payload) => {
    if (payload.type === 'batch_progress') return

    set((s) => {
      const prev = s.streams[reportId] ?? emptyStream()
      const now = Date.now()
      let next: ReportStreamState = { ...prev }

      switch (payload.type) {
        case 'started':
          next = {
            text: '',
            status: 'streaming',
            error: null,
            startedAtMs: now,
            completedAtMs: null,
          }
          break
        case 'delta':
          next = {
            ...prev,
            status: 'streaming',
            text: prev.text + (payload.text ?? ''),
          }
          break
        case 'done':
          next = {
            ...prev,
            status: 'completed',
            completedAtMs: now,
          }
          break
        case 'error':
          next = {
            ...prev,
            status: 'failed',
            error: payload.message,
            completedAtMs: now,
          }
          break
        default:
          return s
      }

      return {
        streams: { ...s.streams, [reportId]: next },
      }
    })
  },

  setBatchProgress: (bulkBatchId, completed, total) =>
    set((s) => ({
      batchProgress: {
        ...s.batchProgress,
        [bulkBatchId]: { completed, total },
      },
    })),

  handleWsPayload: (raw) => {
    const payload = normalizePayload(raw)
    if (!payload) return
    if (payload.type === 'batch_progress') {
      get().setBatchProgress(payload.bulkBatchId, payload.completed, payload.total)
      return
    }
    if ('reportId' in payload) {
      get().applyStreamEvent(payload.reportId, payload)
    }
  },
}))

export function useBatchProgress(bulkBatchId: string | undefined) {
  return useAiReportsStore(
    useShallow((s) => (bulkBatchId ? s.batchProgress[bulkBatchId] : undefined)),
  )
}

/** Subscribe to streaming buffer + status for one report. */
export function useReportStream(reportId: string | undefined) {
  return useAiReportsStore(
    useShallow((s) => (reportId ? s.streams[reportId] : undefined)),
  )
}

export { normalizePayload as normalizeReportStreamPayload }
