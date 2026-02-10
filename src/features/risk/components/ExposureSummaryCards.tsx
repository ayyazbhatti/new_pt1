import { StatCard } from '@/features/dashboard/components/StatCard'

export function ExposureSummaryCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
      <StatCard title="Total Exposure" value="$1,234,567" change="+5%" />
      <StatCard title="Margin Used" value="$456,789" change="+2%" />
      <StatCard title="Available Margin" value="$777,778" change="-3%" />
      <StatCard title="Risk Level" value="Medium" />
    </div>
  )
}

