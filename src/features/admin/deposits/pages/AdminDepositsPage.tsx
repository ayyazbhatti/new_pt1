import { ContentShell, PageHeader } from '@/shared/layout'
import { DepositRequestsPanel } from '../components/DepositRequestsPanel'

export function AdminDepositsPage() {
  return (
    <ContentShell>
      <PageHeader
        title="Deposit Requests"
        description="Review and approve manual deposit requests from users"
      />
      <div className="mt-6">
        <DepositRequestsPanel />
      </div>
    </ContentShell>
  )
}

