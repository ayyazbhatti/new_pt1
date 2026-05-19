import type { ReactNode } from 'react'
import { BulkReportProgressDrawer } from '../modals/BulkReportProgressDrawer'

type OpenModal = (key: string, component: ReactNode, props?: Record<string, unknown>) => void

export function openBulkReportProgressDrawer(
  openModal: OpenModal,
  opts: {
    bulkBatchId: string
    subjectLabels?: Record<string, { name?: string; email?: string }>
    initialTotal?: number
  },
) {
  const key = `ai-report-batch-${opts.bulkBatchId}`
  openModal(
    key,
    <BulkReportProgressDrawer
      bulkBatchId={opts.bulkBatchId}
      subjectLabels={opts.subjectLabels}
      initialTotal={opts.initialTotal}
    />,
    { variant: 'drawer', size: 'lg' },
  )
}
