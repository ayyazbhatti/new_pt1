import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Wallet, ArrowUpFromLine, Building2, Clock } from 'lucide-react'
import { cn } from '@/shared/utils'

function MethodCard({
  title,
  description,
  icon: Icon,
  disabled,
}: {
  title: string
  description: string
  icon: React.ElementType
  disabled?: boolean
}) {
  return (
    <Card
      className={cn(
        'p-5 transition-colors',
        disabled && 'opacity-60',
        !disabled && 'hover:bg-surface-2/50 cursor-pointer'
      )}
    >
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-accent/10 p-3">
          <Icon className="h-6 w-6 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text">{title}</p>
          <p className="mt-0.5 text-sm text-text-muted">{description}</p>
          {!disabled && (
            <Button variant="outline" size="sm" className="mt-3" disabled>
              Select — coming with backend
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

export function UserWithdrawPage() {
  return (
    <ContentShell>
      <PageHeader
        title="Withdraw"
        description="Withdraw funds from your account"
      />

      {/* Available balance */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Available to withdraw</h2>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-surface-2 p-3">
                <Wallet className="h-6 w-6 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-muted">Withdrawable balance</p>
                <p className="text-2xl font-bold text-text">—</p>
                <p className="text-xs text-text-muted">Will load from backend (may exclude margin in use)</p>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Withdraw methods */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Withdraw methods</h2>
        <p className="mb-4 text-sm text-text-muted">
          Choose how you want to receive funds. Limits and fees will be configured by the backend.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <MethodCard
            title="Crypto"
            description="Withdraw to your cryptocurrency wallet. Enter address and amount."
            icon={ArrowUpFromLine}
          />
          <MethodCard
            title="Bank transfer"
            description="Withdraw to your bank account via wire or SEPA."
            icon={Building2}
            disabled
          />
        </div>
      </section>

      {/* How to withdraw */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">How to withdraw</h2>
        <Card className="p-6">
          <ul className="space-y-3 text-sm text-text-muted">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">1</span>
              Select a withdraw method above.
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">2</span>
              Enter amount and destination (wallet address or bank details).
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">3</span>
              Submit the request. Processing time and minimums depend on the method.
            </li>
          </ul>
        </Card>
      </section>

      {/* Recent withdrawals */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-text">Recent withdrawals</h2>
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="mb-3 h-10 w-10 text-text-muted/50" />
            <p className="text-sm font-medium text-text-muted">No withdrawals yet</p>
            <p className="mt-1 text-xs text-text-muted">
              Your withdrawal history will appear here once the backend is connected.
            </p>
          </div>
        </Card>
      </section>
    </ContentShell>
  )
}
