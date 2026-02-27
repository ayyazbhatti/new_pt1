import { useState } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useAuthStore } from '@/shared/store/auth.store'
import { useMyReferrals } from '../hooks/useMyReferrals'
import { UsersRound, DollarSign, Clock, Copy, Check, Gift } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { format } from 'date-fns'

function StatCard({
  title,
  value,
  subtext,
  icon: Icon,
}: {
  title: string
  value: string
  subtext?: string
  icon: React.ElementType
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold text-text">{value}</p>
          {subtext && <p className="mt-0.5 text-xs text-text-muted">{subtext}</p>}
        </div>
        <div className="rounded-lg bg-surface-2 p-2.5">
          <Icon className="h-5 w-5 text-accent" />
        </div>
      </div>
    </Card>
  )
}

export function UserAffiliatePage() {
  const user = useAuthStore((state) => state.user)
  const [copied, setCopied] = useState(false)
  const { data: referrals = [], isLoading: referralsLoading, error: referralsError } = useMyReferrals()

  // Use backend referral_code (from login/me) so register?ref= matches and referred_by_user_id is set
  const refCode = user?.referralCode || (user?.id ? user.id.slice(0, 8) : '')
  const referralUrl =
    refCode && typeof window !== 'undefined'
      ? `${window.location.origin}/register?ref=${encodeURIComponent(refCode)}`
      : refCode
        ? `https://example.com/register?ref=${encodeURIComponent(refCode)}`
        : ''

  const handleCopy = () => {
    navigator.clipboard
      .writeText(referralUrl)
      .then(() => {
        setCopied(true)
        toast.success('Referral link copied')
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => toast.error('Failed to copy'))
  }

  return (
    <ContentShell>
      <PageHeader
        title="Affiliate"
        description="Share your link and earn when friends sign up and trade"
      />

      {/* Referral link */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Your referral link</h2>
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              readOnly
              value={referralUrl}
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="outline"
              size="default"
              onClick={handleCopy}
              className="shrink-0 sm:w-auto"
            >
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4 text-success" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy link
                </>
              )}
            </Button>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Share this link. When someone signs up and trades, you earn a commission. Ref code will be set by the backend.
          </p>
        </Card>
      </section>

      {/* Stats */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Your stats</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            title="Total referrals"
            value={referralsLoading ? '…' : String(referrals.length)}
            subtext="Sign-ups from your link"
            icon={UsersRound}
          />
          <StatCard
            title="Total earned"
            value="—"
            subtext="Commission paid out"
            icon={DollarSign}
          />
          <StatCard
            title="Pending"
            value="—"
            subtext="To be paid next cycle"
            icon={Clock}
          />
        </div>
        {referrals.length > 0 && (
          <p className="mt-2 text-xs text-text-muted">
            Total earned and Pending will appear when commission payouts are enabled.
          </p>
        )}
      </section>

      {/* Referred users */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">Referred users</h2>
        <Card className="overflow-hidden">
          {referralsError && (
            <div className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">
              {(referralsError as Error).message}
            </div>
          )}
          {referralsLoading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              Loading…
            </div>
          ) : referrals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <UsersRound className="mb-3 h-10 w-10 text-text-muted/50" />
              <p className="text-sm font-medium text-text-muted">No referrals yet</p>
              <p className="mt-1 text-xs text-text-muted">
                People who sign up using your link will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-text-muted">User</th>
                    <th className="px-4 py-3 text-left font-medium text-text-muted">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-text-muted">Level</th>
                    <th className="px-4 py-3 text-left font-medium text-text-muted">Signed up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {referrals.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2/30">
                      <td className="px-4 py-3 font-medium text-text">
                        {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-text-muted">{r.email}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-text">
                          Level {typeof r.level === 'number' ? r.level : 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {r.createdAt ? format(new Date(r.createdAt), 'MMM d, yyyy HH:mm') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* How it works — at the end */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-text">How it works</h2>
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-accent/10 p-3">
              <Gift className="h-6 w-6 text-accent" />
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-sm text-text-muted">
              <p className="font-medium text-text">Earn with every referral</p>
              <ul className="list-inside list-disc space-y-1">
                <li>Share your unique link with friends and contacts.</li>
                <li>When they register and start trading, you receive a commission.</li>
                <li>Payouts are processed according to the program terms.</li>
              </ul>
              <p className="pt-2 text-xs">
                Commission rates and payout schedule will be configured by the backend.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </ContentShell>
  )
}
