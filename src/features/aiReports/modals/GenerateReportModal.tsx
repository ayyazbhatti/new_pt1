import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useModalStore } from '@/app/store'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import { generateAiReports, type AiReportSection } from '../api/aiReports.api'
import {
  ReportSectionPicker,
  type ReportSection,
} from '../components/ReportSectionPicker'
import { openBulkReportProgressDrawer } from '../utils/openBulkReportProgressDrawer'
import { openReportStreamingDrawer } from '../utils/openReportStreamingDrawer'

const DEFAULT_SECTIONS: ReportSection[] = [
  'profile',
  'trading_performance',
  'open_positions',
  'risk_profile',
]

export interface GenerateReportModalProps {
  subjectUserIds: string[]
  subjectLabel: string
  subjectEmail?: string
  subjectLabels?: Record<string, { name?: string; email?: string }>
  modalKey?: string
}

export function GenerateReportModal({
  subjectUserIds,
  subjectLabel,
  subjectEmail,
  subjectLabels,
  modalKey = 'generate-ai-report',
}: GenerateReportModalProps) {
  const openModal = useModalStore((s) => s.openModal)
  const closeModal = useModalStore((s) => s.closeModal)

  const [sections, setSections] = useState<ReportSection[]>(DEFAULT_SECTIONS)
  const [focus, setFocus] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const nonProfileCount = useMemo(
    () => sections.filter((s) => s !== 'profile').length,
    [sections],
  )

  const isBulk = subjectUserIds.length > 1

  const handleSubmit = async () => {
    if (nonProfileCount === 0 || submitting) return
    setSubmitting(true)
    try {
      const result = await generateAiReports({
        subjectUserIds,
        sections: sections as AiReportSection[],
        focusPrompt: focus.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      })

      closeModal(modalKey)

      if (result.bulkBatchId) {
        openBulkReportProgressDrawer(openModal, {
          bulkBatchId: result.bulkBatchId,
          subjectLabels,
          initialTotal: result.reportIds.length,
        })
        return
      }

      const reportId = result.reportIds[0]
      if (!reportId) {
        toast.error('No report id returned')
        return
      }

      openReportStreamingDrawer(openModal, closeModal, {
        reportId,
        subjectName: subjectLabel,
        subjectEmail,
      })
    } catch (e) {
      toast.error(getApiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        {isBulk ? (
          <>
            Generate AI reports for <strong className="text-text">{subjectUserIds.length} users</strong>.
            Each report streams to you when ready.
          </>
        ) : (
          <>
            Generate an AI report for{' '}
            <strong className="text-text">{subjectLabel}</strong>
            {subjectEmail ? (
              <>
                {' '}
                (<span className="font-mono text-xs">{subjectEmail}</span>)
              </>
            ) : null}
            .
          </>
        )}
      </p>

      <ReportSectionPicker
        value={sections}
        focus={focus}
        onChange={setSections}
        onFocusChange={setFocus}
        disabled={submitting}
      />

      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={() => closeModal(modalKey)}
        >
          Cancel
        </Button>
        <Button type="button" disabled={submitting || nonProfileCount === 0} onClick={() => void handleSubmit()}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting…
            </>
          ) : (
            'Generate Report'
          )}
        </Button>
      </div>
    </div>
  )
}
