import { useState } from 'react'
import { PageHeader } from '@/shared/layout'
import { ContentShell } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'

const STEPS = ['Upload CSV', 'Map columns', 'Validate', 'Confirm']

export function LeadsImportPage() {
  const [step, setStep] = useState(0)

  return (
    <ContentShell>
      <PageHeader title="Import leads" description="Upload a CSV and map columns to import." />
      <div className="flex gap-2 mb-6">
        {STEPS.map((s, i) => (
          <Button
            key={s}
            variant={step === i ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setStep(i)}
          >
            {i + 1}. {s}
          </Button>
        ))}
      </div>
      <Card className="p-6 border border-border">
        {step === 0 && (
          <div>
            <p className="text-sm text-text-muted mb-4">Upload a CSV file with lead data.</p>
            <div className="border border-dashed border-border rounded-lg p-8 text-center text-text-muted">
              Drop CSV here or click to browse
            </div>
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="text-sm text-text-muted mb-4">Map your CSV columns to lead fields.</p>
            <div className="text-sm text-text-muted">Column mapping UI (static)</div>
          </div>
        )}
        {step === 2 && (
          <div>
            <p className="text-sm text-text-muted mb-4">Review validation results.</p>
            <div className="text-sm text-text-muted">Validation preview (static)</div>
          </div>
        )}
        {step === 3 && (
          <div>
            <p className="text-sm text-text-muted mb-4">Confirm and import.</p>
            <Button disabled>Import (no backend)</Button>
          </div>
        )}
      </Card>
    </ContentShell>
  )
}
