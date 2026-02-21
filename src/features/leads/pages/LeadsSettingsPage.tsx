import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { useLeadStages } from '../hooks/useLeadStages'
import { cn } from '@/shared/utils'

export function LeadsSettingsPage() {
  const { data: stages } = useLeadStages()

  return (
    <ContentShell>
      <PageHeader title="Leads settings" description="Manage pipeline stages and lead sources." />
      <div className="space-y-6">
        <Card className="p-4 border border-border">
          <h3 className="text-sm font-medium text-text mb-3">Pipeline stages</h3>
          <p className="text-sm text-text-muted mb-4">Add, edit, or reorder stages. SLA and rules are configured per stage.</p>
          <ul className="space-y-2">
            {(stages ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
                style={{ borderLeftWidth: '4px', borderLeftColor: s.colorToken }}
              >
                <span className="font-medium text-text">{s.name}</span>
                <span className="text-xs text-text-muted">
                  SLA: {s.slaMinutes != null ? `${s.slaMinutes} min` : '—'}
                </span>
                {s.rules?.requireEmail && <span className="text-xs text-text-muted">Require email</span>}
                {s.rules?.requirePhone && <span className="text-xs text-text-muted">Require phone</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4 border border-border">
          <h3 className="text-sm font-medium text-text mb-3">Lead sources</h3>
          <p className="text-sm text-text-muted">Manage lead source list and tag presets. (Static UI.)</p>
        </Card>
      </div>
    </ContentShell>
  )
}
