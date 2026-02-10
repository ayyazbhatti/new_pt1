import { ContentShell, PageHeader } from '@/shared/layout'
import { StatCard } from '../components/StatCard'

export function DashboardPage() {
  return (
    <ContentShell>
      <PageHeader
        title="Dashboard"
        description="Overview of your trading platform"
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Users" value="1,234" change="+12%" />
        <StatCard title="Active Trades" value="567" change="+5%" />
        <StatCard title="Revenue" value="$45,678" change="+8%" />
        <StatCard title="Risk Exposure" value="$123,456" change="-2%" />
      </div>
    </ContentShell>
  )
}

