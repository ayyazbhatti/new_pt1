import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Card } from '@/shared/ui/card'

export function LeadsAnalyticsPage() {
  return (
    <ContentShell>
      <PageHeader title="Leads analytics" description="Charts and metrics (placeholder)." />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border border-border">
          <p className="text-sm text-text-muted">Total leads</p>
          <p className="text-2xl font-semibold text-text">—</p>
        </Card>
        <Card className="p-4 border border-border">
          <p className="text-sm text-text-muted">Conversion rate</p>
          <p className="text-2xl font-semibold text-text">—</p>
        </Card>
        <Card className="p-4 border border-border">
          <p className="text-sm text-text-muted">Avg. response time</p>
          <p className="text-2xl font-semibold text-text">—</p>
        </Card>
        <Card className="p-4 border border-border">
          <p className="text-sm text-text-muted">By stage</p>
          <p className="text-2xl font-semibold text-text">—</p>
        </Card>
      </div>
      <Card className="p-6 border border-border mt-6">
        <p className="text-sm text-text-muted">Charts placeholder</p>
      </Card>
    </ContentShell>
  )
}
