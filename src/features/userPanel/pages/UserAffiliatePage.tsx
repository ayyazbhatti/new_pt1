import { useState, useMemo } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useAuthStore } from '@/shared/store/auth.store'
import { useMyReferrals } from '../hooks/useMyReferrals'
import {
  UsersRound,
  DollarSign,
  Copy,
  Check,
  Gift,
  BarChart3,
  ChevronRight,
} from 'lucide-react'
import { toast } from '@/shared/components/common'
import { format } from 'date-fns'
import { cn } from '@/shared/utils'

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
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-text">{value}</p>
          {subtext && <p className="mt-0.5 text-xs text-text-muted">{subtext}</p>}
        </div>
        <div className="rounded-lg bg-surface-2 p-2.5 shrink-0">
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

  const refCode = user?.referralCode || (user?.id ? user.id.slice(0, 8) : '')
  const referralUrl =
    refCode && typeof window !== 'undefined'
      ? `${window.location.origin}/register?ref=${encodeURIComponent(refCode)}`
      : refCode
        ? `https://example.com/register?ref=${encodeURIComponent(refCode)}`
        : ''

  const levelCounts = useMemo(() => {
    const l1 = referrals.filter((r) => (typeof r.level === 'number' ? r.level : 1) === 1).length
    const l2 = referrals.filter((r) => (typeof r.level === 'number' ? r.level : 1) === 2).length
    const l3 = referrals.filter((r) => (typeof r.level === 'number' ? r.level : 1) === 3).length
    return { level1: l1, level2: l2, level3: l3 }
  }, [referrals])

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
        title="Affiliate Dashboard"
        description="Manage your referral program"
      />

      {/* Top stats — 4 cards */}
      <section className="mb-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Affiliate Balance"
            value="$0.00"
            subtext="Available for withdrawal"
            icon={DollarSign}
          />
          <StatCard
            title="Level 1"
            value={referralsLoading ? '…' : String(levelCounts.level1)}
            subtext="Referrals"
            icon={UsersRound}
          />
          <StatCard
            title="Level 2"
            value={referralsLoading ? '…' : String(levelCounts.level2)}
            subtext="Referrals"
            icon={UsersRound}
          />
          <StatCard
            title="Level 3"
            value={referralsLoading ? '…' : String(levelCounts.level3)}
            subtext="Referrals"
            icon={UsersRound}
          />
        </div>
      </section>

      {/* Your referral link */}
      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-text">Your Referral Link</h2>
        <p className="mb-4 text-sm text-text-muted">Share this link to earn commissions</p>
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              readOnly
              value={referralUrl}
              className="flex-1 font-mono text-sm bg-surface-2/50 border-border"
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
                  Copy
                </>
              )}
            </Button>
          </div>
          {refCode && (
            <p className="mt-4 text-sm text-text-muted">
              Your referral code: <span className="font-mono font-medium text-text">{refCode}</span>
            </p>
          )}
        </Card>
      </section>

      {/* Quick Actions + Recent Activity */}
      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-base font-semibold text-text">Quick Actions</h3>
          <ul className="space-y-1">
            <li>
              <a
                href="#referred-users"
                className={cn(
                  'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-text',
                  'hover:bg-surface-2/50 transition-colors'
                )}
              >
                <span className="flex items-center gap-3">
                  <UsersRound className="h-4 w-4 text-accent" />
                  View Referrals
                </span>
                <ChevronRight className="h-4 w-4 text-text-muted" />
              </a>
            </li>
            <li>
              <span
                className={cn(
                  'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-text-muted cursor-not-allowed'
                )}
                title="Coming soon"
              >
                <span className="flex items-center gap-3">
                  <BarChart3 className="h-4 w-4" />
                  Commission History
                </span>
                <ChevronRight className="h-4 w-4" />
              </span>
            </li>
            <li>
              <span
                className={cn(
                  'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-text-muted cursor-not-allowed'
                )}
                title="Coming soon"
              >
                <span className="flex items-center gap-3">
                  <DollarSign className="h-4 w-4" />
                  Request Withdrawal
                </span>
                <ChevronRight className="h-4 w-4" />
              </span>
            </li>
          </ul>
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-text">Recent Activity</h3>
            <span className="text-xs text-text-muted">View all transactions →</span>
          </div>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-text-muted">No recent activity</p>
            <p className="mt-1 text-xs text-text-muted">
              Commissions and payouts will appear here
            </p>
          </div>
        </Card>
      </section>

      {/* Referred users table */}
      <section id="referred-users" className="mb-8 scroll-mt-6">
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
