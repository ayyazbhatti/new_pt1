import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Switch } from '@/shared/ui/Switch'
import { mockUsers } from '../api/leads.mock'
import { useState } from 'react'

export function LeadsAssignmentPage() {
  const [strategy, setStrategy] = useState<'round_robin' | 'manual'>('manual')
  const [autoAssign, setAutoAssign] = useState(false)

  return (
    <ContentShell>
      <PageHeader title="Assignment rules" description="Choose how new leads are assigned to agents." />
      <div className="space-y-6">
        <Card className="p-4 border border-border">
          <h3 className="text-sm font-medium text-text mb-3">Strategy</h3>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="strategy"
                checked={strategy === 'round_robin'}
                onChange={() => setStrategy('round_robin')}
                className="rounded-full border-border"
              />
              <span className="text-sm text-text">Round robin per team</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="strategy"
                checked={strategy === 'manual'}
                onChange={() => setStrategy('manual')}
                className="rounded-full border-border"
              />
              <span className="text-sm text-text">Manual</span>
            </label>
          </div>
        </Card>
        <Card className="p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-text">Auto-assign new leads</h3>
              <p className="text-xs text-text-muted">When enabled, new leads are assigned according to the strategy above.</p>
            </div>
            <Switch checked={autoAssign} onCheckedChange={setAutoAssign} />
          </div>
        </Card>
        <Card className="p-4 border border-border">
          <h3 className="text-sm font-medium text-text mb-3">Agents workload (mock)</h3>
          <ul className="space-y-2">
            {mockUsers.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-text">{u.name}</span>
                <span className="text-sm text-text-muted">12 leads</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </ContentShell>
  )
}
