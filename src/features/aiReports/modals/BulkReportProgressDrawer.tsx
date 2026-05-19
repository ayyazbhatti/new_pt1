import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Eye, Loader2 } from 'lucide-react'
import { useModalStore } from '@/app/store'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'
import {
  getAiReportBatch,
  type AiReportDto,
  type AiReportStatus,
} from '../api/aiReports.api'
import { normalizeReportStreamPayload, useBatchProgress } from '../store/aiReportsStore'
import { openReportStreamingDrawer } from '../utils/openReportStreamingDrawer'

function statusVariant(status: AiReportStatus): 'success' | 'danger' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    case 'streaming':
      return 'info'
    case 'pending':
      return 'warning'
    default:
      return 'neutral'
  }
}

function sortReports(reports: AiReportDto[]): AiReportDto[] {
  const rank = (s: AiReportStatus) => {
    if (s === 'pending' || s === 'streaming') return 0
    if (s === 'failed') return 1
    return 2
  }
  return [...reports].sort((a, b) => rank(a.status) - rank(b.status))
}

export interface BulkReportProgressDrawerProps {
  bulkBatchId: string
  subjectLabels?: Record<string, { name?: string; email?: string }>
  initialTotal?: number
}

export function BulkReportProgressDrawer({
  bulkBatchId,
  subjectLabels = {},
  initialTotal,
}: BulkReportProgressDrawerProps) {
  const queryClient = useQueryClient()
  const openModal = useModalStore((s) => s.openModal)
  const closeModal = useModalStore((s) => s.closeModal)
  const wsProgress = useBatchProgress(bulkBatchId)
  const [collapsedCompleted, setCollapsedCompleted] = useState(true)

  const batchQuery = useQuery({
    queryKey: ['ai-reports', 'batch', bulkBatchId],
    queryFn: () => getAiReportBatch(bulkBatchId),
    enabled: Boolean(bulkBatchId),
  })

  useEffect(() => {
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type !== 'ai.report.delta') return
      const payload = normalizeReportStreamPayload(event.payload)
      if (!payload) return

      if (payload.type === 'batch_progress') {
        if (payload.bulkBatchId !== bulkBatchId) return
        return
      }

      const eventBatchId =
        'bulkBatchId' in payload ? payload.bulkBatchId ?? undefined : undefined
      if (eventBatchId && eventBatchId !== bulkBatchId) return

      void queryClient.invalidateQueries({ queryKey: ['ai-reports', 'batch', bulkBatchId] })
    })
    return unsubscribe
  }, [bulkBatchId, queryClient])

  const reports = batchQuery.data ?? []
  const total = wsProgress?.total ?? initialTotal ?? reports.length
  const completedFromRows = reports.filter(
    (r) => r.status === 'completed' || r.status === 'failed',
  ).length
  const completed = wsProgress?.completed ?? completedFromRows
  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0

  const { activeReports, completedReports } = useMemo(() => {
    const sorted = sortReports(reports)
    const active = sorted.filter((r) => r.status === 'pending' || r.status === 'streaming')
    const done = sorted.filter((r) => r.status === 'completed' || r.status === 'failed')
    return { activeReports: active, completedReports: done }
  }, [reports])

  const resolveLabel = (report: AiReportDto) => {
    const meta = subjectLabels[report.subjectUserId]
    if (meta?.email) return meta.email
    if (meta?.name) return meta.name
    return report.subjectUserId.slice(0, 8) + '…'
  }

  const handleView = (report: AiReportDto) => {
    const meta = subjectLabels[report.subjectUserId]
    openReportStreamingDrawer(openModal, closeModal, {
      reportId: report.id,
      subjectName: meta?.name,
      subjectEmail: meta?.email,
    })
  }

  const renderRow = (report: AiReportDto, compact?: boolean) => (
    <li
      key={report.id}
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2',
        compact && 'py-1.5',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{resolveLabel(report)}</p>
        {!compact && report.error && (
          <p className="text-xs text-red-400 mt-0.5 truncate">{report.error}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={statusVariant(report.status)} className="capitalize">
          {report.status}
        </Badge>
        {report.status === 'completed' && (
          <Button type="button" variant="ghost" size="sm" onClick={() => handleView(report)}>
            <Eye className="h-4 w-4" />
            <span className="sr-only">View</span>
          </Button>
        )}
      </div>
    </li>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-800">
      <header className="shrink-0 border-b border-slate-700 px-4 py-4">
        <h2 className="text-base font-semibold text-white sm:text-lg">
          Bulk report generation — {completed}/{total} completed
        </h2>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {batchQuery.isLoading && (
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading batch…
          </p>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-modal p-4 space-y-4">
        {activeReports.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              In progress
            </h3>
            <ul className="space-y-2">{activeReports.map((r) => renderRow(r))}</ul>
          </section>
        )}

        {completedReports.length > 0 && (
          <section>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 hover:text-slate-200"
              onClick={() => setCollapsedCompleted((v) => !v)}
            >
              {collapsedCompleted ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Completed ({completedReports.length})
            </button>
            {!collapsedCompleted && (
              <ul className="space-y-1.5">
                {completedReports.map((r) => renderRow(r, true))}
              </ul>
            )}
          </section>
        )}

        {!batchQuery.isLoading && reports.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Waiting for reports to appear…</p>
        )}
      </div>
    </div>
  )
}
