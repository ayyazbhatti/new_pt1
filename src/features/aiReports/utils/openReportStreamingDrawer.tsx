import type { ReactNode } from 'react'
import { ReportStreamingView } from '../components/ReportStreamingView'

type OpenModal = (key: string, component: ReactNode, props?: Record<string, unknown>) => void
type CloseModal = (key: string) => void

export function openReportStreamingDrawer(
  openModal: OpenModal,
  closeModal: CloseModal,
  opts: {
    reportId: string
    subjectName?: string
    subjectEmail?: string
  },
) {
  const key = `ai-report-view-${opts.reportId}`

  const open = (reportId: string) => {
    openModal(
      key,
      <ReportStreamingView
        reportId={reportId}
        subjectName={opts.subjectName}
        subjectEmail={opts.subjectEmail}
        className="h-full"
        onClose={() => closeModal(key)}
        onRegenerate={(newReportId) => {
          closeModal(key)
          openReportStreamingDrawer(openModal, closeModal, {
            ...opts,
            reportId: newReportId,
          })
        }}
      />,
      { variant: 'drawer' },
    )
  }

  open(opts.reportId)
}
