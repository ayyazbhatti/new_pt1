import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, RefreshCw, X } from 'lucide-react'
import { cn } from '@/shared/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import { useCanAccess } from '@/shared/utils/permissions'
import {
  generateAiReports,
  getAiReport,
  type AiReportStatus,
} from '../api/aiReports.api'
import { useAiReportsStore, useReportStream } from '../store/aiReportsStore'
import { ReportMarkdown } from './ReportMarkdown'

export interface ReportStreamingViewProps {
  reportId: string
  subjectName?: string
  subjectEmail?: string
  onClose?: () => void
  onRegenerate?: (newReportId: string) => void
  className?: string
}

function statusBadgeVariant(
  status: AiReportStatus,
): 'neutral' | 'info' | 'success' | 'danger' | 'warning' {
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

function formatStatus(status: AiReportStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatDurationMs(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  return `${sec} second${sec === 1 ? '' : 's'}`
}

export function ReportStreamingView({
  reportId,
  subjectName,
  subjectEmail,
  onClose,
  onRegenerate,
  className,
}: ReportStreamingViewProps) {
  const queryClient = useQueryClient()
  const canGenerate = useCanAccess('ai_reports:generate')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [regenerating, setRegenerating] = useState(false)
  const initStream = useAiReportsStore((s) => s.initStream)

  const stream = useReportStream(reportId)

  const reportQuery = useQuery({
    queryKey: ['ai-report', reportId],
    queryFn: () => getAiReport(reportId),
    enabled: Boolean(reportId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'pending' || status === 'streaming') return false
      return false
    },
  })

  const report = reportQuery.data

  useEffect(() => {
    if (!reportId) return
    if (report?.status === 'pending') {
      initStream(reportId, 'pending')
    }
  }, [reportId, report?.status, initStream])

  const displayStatus: AiReportStatus = useMemo(() => {
    if (stream?.status && (stream.status === 'streaming' || stream.text)) {
      return stream.status
    }
    return report?.status ?? 'pending'
  }, [stream?.status, stream?.text, report?.status])

  const displayContent = useMemo(() => {
    if (stream?.text) return stream.text
    return report?.content ?? ''
  }, [stream?.text, report?.content])

  const displayError = stream?.error ?? report?.error ?? null

  const durationLabel = useMemo(() => {
    if (stream?.startedAtMs && stream.completedAtMs) {
      return formatDurationMs(stream.completedAtMs - stream.startedAtMs)
    }
    if (report?.completedAt && report.createdAt) {
      const ms =
        new Date(report.completedAt).getTime() - new Date(report.createdAt).getTime()
      if (ms > 0) return formatDurationMs(ms)
    }
    return null
  }, [stream?.startedAtMs, stream?.completedAtMs, report?.completedAt, report?.createdAt])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [displayContent])

  useEffect(() => {
    if (stream?.status !== 'completed') return
    void queryClient.invalidateQueries({ queryKey: ['ai-report', reportId] })
  }, [stream?.status, reportId, queryClient])

  const handleCopy = useCallback(async () => {
    const text = displayContent.trim()
    if (!text) {
      toast.error('Nothing to copy yet')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Report copied to clipboard')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }, [displayContent])

  const handleRegenerate = useCallback(async () => {
    if (!report || regenerating) return
    setRegenerating(true)
    try {
      const result = await generateAiReports({
        subjectUserIds: [report.subjectUserId],
        sections: report.sections,
        focusPrompt: report.focusPrompt ?? undefined,
        idempotencyKey: crypto.randomUUID(),
      })
      const newId = result.reportIds[0]
      if (!newId) {
        toast.error('No report id returned')
        return
      }
      initStream(newId, 'pending')
      onRegenerate?.(newId)
      toast.success('Regenerating report…')
    } catch (e) {
      toast.error(getApiErrorMessage(e))
    } finally {
      setRegenerating(false)
    }
  }, [report, regenerating, initStream, onRegenerate])

  const headerTitle = subjectName?.trim() || `User ${report?.subjectUserId?.slice(0, 8) ?? '…'}`
  const headerEmail = subjectEmail?.trim()

  const isStreaming =
    displayStatus === 'streaming' ||
    displayStatus === 'pending' ||
    (displayStatus === 'completed' && stream?.status === 'streaming')

  return (
    <div className={cn('flex flex-col h-full min-h-0 bg-slate-800', className)}>
      <header className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text truncate">{headerTitle}</h2>
          {headerEmail && (
            <p className="text-xs text-text-muted truncate mt-0.5">{headerEmail}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={statusBadgeVariant(displayStatus)}>{formatStatus(displayStatus)}</Badge>
            {durationLabel && displayStatus === 'completed' && (
              <span className="text-[10px] text-text-muted">Generated in {durationLabel}</span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {displayError && (
        <div className="shrink-0 mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {displayError}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-modal px-4 py-4">
        {reportQuery.isLoading && !displayContent ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading report…
          </div>
        ) : (
          <>
            <ReportMarkdown content={displayContent} />
            {isStreaming && !displayContent.trim() && (
              <p className="text-sm text-text-muted italic mt-2">Thinking…</p>
            )}
            {isStreaming && displayContent.trim() && (
              <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse align-middle" />
            )}
          </>
        )}
      </div>

      {displayStatus === 'completed' && displayContent.trim() && (
        <footer className="shrink-0 flex flex-wrap gap-2 border-t border-slate-700 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copy markdown
          </Button>
          {canGenerate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={regenerating}
              onClick={() => void handleRegenerate()}
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Regenerate
            </Button>
          )}
        </footer>
      )}
    </div>
  )
}
