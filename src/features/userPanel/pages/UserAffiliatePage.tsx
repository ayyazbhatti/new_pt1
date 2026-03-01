import { useState, useMemo } from 'react'
import { ContentShell } from '@/shared/layout'
import {
  DollarSign,
  Users,
  TrendingUp,
  CheckCircle,
  Plus,
  Share2,
  XCircle,
} from 'lucide-react'
import { useAuthStore } from '@/shared/store/auth.store'
import { useMyReferrals } from '../hooks/useMyReferrals'
import { toast } from '@/shared/components/common'
import { format } from 'date-fns'
import { cn } from '@/shared/utils'

type UserTab = 'overview' | 'referrals' | 'commissions'

// Placeholder commission structure (UI only; could come from scheme in future)
const DEFAULT_LEVELS = [
  { level: 1, percent: 10, label: 'Direct referrals' },
  { level: 2, percent: 5, label: 'Sub-referrals' },
  { level: 3, percent: 2, label: 'Nested referrals' },
]

// Placeholder commissions (UI only)
const PLACEHOLDER_COMMISSIONS: { id: string; amount: string; basis: string; status: 'Paid' | 'Approved' | 'Accrued'; date: string }[] = []

function StatusBadge({ status }: { status: 'Paid' | 'Approved' | 'Accrued' | string }) {
  const styles =
    status === 'Paid'
      ? 'bg-green-500/20 text-green-400 border-green-500/50'
      : status === 'Approved'
        ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
        : status === 'Accrued'
          ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
          : 'bg-slate-500/20 text-slate-400 border-slate-500/50'
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border',
        styles
      )}
    >
      {status}
    </span>
  )
}

interface JoinAffiliateModalProps {
  onClose: () => void
  onJoin?: (schemeId?: string) => void
  assignedSchemeName?: string | null
  assignedGroupName?: string | null
}

function JoinAffiliateModal({
  onClose,
  onJoin,
  assignedSchemeName,
  assignedGroupName,
}: JoinAffiliateModalProps) {
  const [loading] = useState(false)
  const schemes: { id: string; name: string; levels: string }[] = [] // Would come from API

  const hasAssigned = assignedSchemeName && assignedSchemeName.length > 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-2 sm:p-4">
      <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 w-full max-w-[calc(100vw-1rem)] sm:max-w-md border border-slate-700 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base sm:text-lg md:text-xl font-bold text-white">
            Join Affiliate Program
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white"
          >
            <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {hasAssigned ? (
          <>
            <div className="bg-slate-700/50 rounded-lg p-3 sm:p-4 border border-slate-600 mb-4 text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm sm:text-base text-white">
                  {assignedSchemeName}
                </span>
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-medium rounded-full border border-blue-500/50">
                  Assigned
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">1: 10%, 2: 5%</p>
              {assignedGroupName && (
                <p className="text-xs text-slate-400 mt-1">
                  Assigned to your group: {assignedGroupName}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onJoin?.()}
              className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm sm:text-base font-medium"
            >
              Join This Scheme
            </button>
          </>
        ) : (
          <>
            <p className="text-xs sm:text-sm text-slate-400 mb-4">
              Select a commission scheme to join the affiliate program:
            </p>
            {loading ? (
              <p className="text-sm text-slate-400">Loading schemes...</p>
            ) : schemes.length === 0 ? (
              <p className="text-red-400 text-sm">No schemes available</p>
            ) : (
              <div className="space-y-2">
                {schemes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onJoin?.(s.id)}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-left"
                  >
                    <span className="font-semibold text-sm sm:text-base block">{s.name}</span>
                    <span className="text-xs sm:text-sm text-blue-200 break-words">{s.levels}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function UserAffiliatePage() {
  const user = useAuthStore((state) => state.user)
  const [copied, setCopied] = useState(false)
  const [joinModalOpen, setJoinModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<UserTab>('overview')

  const { data: referrals = [], isLoading: referralsLoading } = useMyReferrals()

  const isEnrolled = Boolean(user?.referralCode)
  const refCode = user?.referralCode || (user?.id ? user.id.slice(0, 8) : '')
  const referralUrl =
    refCode && typeof window !== 'undefined'
      ? `${window.location.origin}/register?ref=${encodeURIComponent(refCode)}`
      : refCode
        ? `https://example.com/register?ref=${encodeURIComponent(refCode)}`
        : ''

  const activeCount = useMemo(
    () => referrals.filter((r) => (r as { active?: boolean }).active !== false).length,
    [referrals]
  )
  const totalCommission = '$0.00'
  const paidCommission = '$0.00'

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

  const handleJoin = () => {
    setJoinModalOpen(false)
    toast.success('Joined affiliate program')
  }

  // —— Not enrolled state ——
  if (!isEnrolled) {
    const assignedSchemeName: string | null = null
    const assignedGroupName: string | null = null

    return (
      <ContentShell className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Affiliate Program</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Join our affiliate program and start earning commissions
          </p>
        </div>

        <div className="bg-slate-800 rounded-lg p-4 sm:p-6 md:p-8 border border-slate-700 text-center">
          <div className="p-3 sm:p-4 bg-blue-500/10 rounded-full w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 flex items-center justify-center">
            <DollarSign className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400" />
          </div>
          <h2 className="text-base sm:text-xl font-semibold text-white mb-2">
            Join Affiliate Program
          </h2>
          {assignedSchemeName ? (
            <>
              <p className="text-xs sm:text-sm text-slate-400 mb-4 sm:mb-6">
                You can join the affiliate scheme assigned to your group:
              </p>
              <div className="bg-slate-700/50 rounded-lg p-3 sm:p-4 border border-slate-600 mb-4 sm:mb-6 text-left max-w-md mx-auto">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm sm:text-base text-white">
                    {assignedSchemeName}
                  </span>
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-medium rounded-full border border-blue-500/50">
                    Assigned
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-1">1: X%, 2: Y%, …</p>
                {assignedGroupName && (
                  <p className="text-xs text-slate-400 mt-1">
                    Assigned to your group: {assignedGroupName}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setJoinModalOpen(true)}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center space-x-2 mx-auto text-sm sm:text-base"
              >
                <Plus className="w-4 h-4" />
                <span>Join This Scheme</span>
              </button>
            </>
          ) : (
            <>
              <p className="text-xs sm:text-sm text-slate-400 mb-4 sm:mb-6">
                Start earning commissions by referring new users to our platform
              </p>
              <button
                type="button"
                onClick={() => setJoinModalOpen(true)}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center space-x-2 mx-auto text-sm sm:text-base"
              >
                <Plus className="w-4 h-4" />
                <span>Join Now</span>
              </button>
            </>
          )}
        </div>

        {joinModalOpen && (
          <JoinAffiliateModal
            onClose={() => setJoinModalOpen(false)}
            onJoin={handleJoin}
            assignedSchemeName={assignedSchemeName}
            assignedGroupName={assignedGroupName}
          />
        )}
      </ContentShell>
    )
  }

  // —— Enrolled state: dashboard ——
  const tabStyles = (active: boolean) =>
    active
      ? 'bg-blue-600 text-white'
      : 'text-slate-400 hover:text-white hover:bg-slate-700'

  return (
    <ContentShell className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Affiliate Program</h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Manage your affiliate and referral program
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
        <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-slate-400 truncate">
                Total Referrals
              </p>
              <p className="text-lg sm:text-xl md:text-2xl font-bold text-white mt-1 truncate">
                {referralsLoading ? '…' : referrals.length}
              </p>
            </div>
            <div className="p-2 sm:p-2.5 md:p-3 rounded-lg text-blue-400 bg-blue-400/10">
              <Users className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-slate-400 truncate">
                Active Referrals
              </p>
              <p className="text-lg sm:text-xl md:text-2xl font-bold text-green-400 mt-1 truncate">
                {referralsLoading ? '…' : activeCount}
              </p>
            </div>
            <div className="p-2 sm:p-2.5 md:p-3 rounded-lg text-green-400 bg-green-400/10">
              <TrendingUp className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-slate-400 truncate">
                Total Commission
              </p>
              <p className="text-lg sm:text-xl md:text-2xl font-bold text-white mt-1 truncate">
                {totalCommission}
              </p>
            </div>
            <div className="p-2 sm:p-2.5 md:p-3 rounded-lg text-purple-400 bg-purple-400/10">
              <DollarSign className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-slate-400 truncate">
                Paid Commission
              </p>
              <p className="text-lg sm:text-xl md:text-2xl font-bold text-green-400 mt-1 truncate">
                {paidCommission}
              </p>
            </div>
            <div className="p-2 sm:p-2.5 md:p-3 rounded-lg text-green-400 bg-green-400/10">
              <CheckCircle className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Affiliate link section */}
      <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 sm:p-2 bg-blue-500/10 rounded-lg">
            <Share2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white">Your Affiliate Link</h2>
            <p className="text-xs sm:text-sm text-slate-400">Share this link to earn commissions</p>
          </div>
        </div>
        <div className="bg-slate-700/50 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400 mb-1">Affiliate Code</p>
            <p className="text-base sm:text-lg font-mono font-medium text-white break-all">
              {refCode}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center space-x-2 text-sm sm:text-base shrink-0"
          >
            {copied ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4" />
                <span>Copy Link</span>
              </>
            )}
          </button>
        </div>
        <div className="mt-3 sm:mt-4 bg-slate-700/50 rounded-lg p-3 sm:p-4">
          <p className="text-xs text-slate-400 mb-1">Referral Link</p>
          <p className="text-xs sm:text-sm text-slate-300 break-all">{referralUrl}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg overflow-x-auto scrollbar-hide">
        {[
          { id: 'overview' as const, label: 'Overview', icon: DollarSign },
          { id: 'referrals' as const, label: 'Referrals', icon: Users },
          { id: 'commissions' as const, label: 'Commissions', icon: TrendingUp },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium flex-shrink-0',
                tabStyles(isActive)
              )}
            >
              <Icon className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="bg-slate-800 rounded-lg p-4 sm:p-5 md:p-6 border border-slate-700">
          <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">
            Commission Structure
          </h3>
          {DEFAULT_LEVELS.length === 0 ? (
            <p className="text-slate-400 text-sm">No commission structure available</p>
          ) : (
            <div className="space-y-2">
              {DEFAULT_LEVELS.map((lev) => (
                <div
                  key={lev.level}
                  className="p-3 sm:p-4 bg-slate-700/50 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs sm:text-sm font-medium text-white">
                      Level {lev.level} Commission
                    </p>
                    <p className="text-xs text-slate-400">{lev.label}</p>
                  </div>
                  <span
                    className={cn(
                      'text-base sm:text-lg font-bold',
                      lev.level === 1 && 'text-green-400',
                      lev.level === 2 && 'text-blue-400',
                      lev.level >= 3 && 'text-purple-400'
                    )}
                  >
                    {lev.percent}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'referrals' && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="p-3 sm:p-4 md:p-6 border-b border-slate-700">
            <h3 className="text-base sm:text-lg font-semibold text-white">My Referrals</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    User Email
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Level
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Referred Date
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Total Commission
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {referrals.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-700/50">
                    <td className="px-3 sm:px-4 md:px-6 py-3 text-white">{r.email}</td>
                    <td className="px-3 sm:px-4 md:px-6 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border border-slate-600 text-slate-300">
                        Level {typeof r.level === 'number' ? r.level : 1}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 md:px-6 py-3 text-slate-400">
                      {r.createdAt ? format(new Date(r.createdAt), 'PP') : '—'}
                    </td>
                    <td className="px-3 sm:px-4 md:px-6 py-3 text-slate-300">$0.00</td>
                  </tr>
                ))}
                {referrals.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No referrals yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'commissions' && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="p-3 sm:p-4 md:p-6 border-b border-slate-700">
            <h3 className="text-base sm:text-lg font-semibold text-white">Commission History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Basis
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 sm:px-4 md:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {PLACEHOLDER_COMMISSIONS.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-700/50">
                    <td className="px-3 sm:px-4 md:px-6 py-3 font-mono text-white">{c.amount}</td>
                    <td className="px-3 sm:px-4 md:px-6 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border border-slate-600 text-slate-300">
                        {c.basis}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 md:px-6 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 sm:px-4 md:px-6 py-3 text-slate-400">{c.date}</td>
                  </tr>
                ))}
                {PLACEHOLDER_COMMISSIONS.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No commissions yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ContentShell>
  )
}
