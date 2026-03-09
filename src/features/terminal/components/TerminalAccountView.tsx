import { useState } from 'react'
import { LayoutDashboard, Bell, CreditCard, MessageCircle, Settings, LogOut } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Skeleton } from '@/shared/ui'
import { useTerminalStore } from '../store'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWalletStore } from '@/shared/store/walletStore'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/shared/components/common'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { DepositModal } from '@/features/wallet/components/DepositModal'
import { WithdrawModal } from '@/features/wallet/components/WithdrawModal'
import { cn } from '@/shared/utils'

interface TerminalAccountViewProps {
  onOpenDeposit?: () => void
}

/**
 * Mobile Account tab: balance, equity, margin, deposit/withdraw, notifications, chat, payment, settings, logout.
 * Reuses same data as LeftSidebar (wallet store, account summary).
 */
export function TerminalAccountView({ onOpenDeposit }: TerminalAccountViewProps) {
  const {
    setNotificationPanelOpen,
    setPaymentPanelOpen,
    setChatPanelOpen,
    setSettingsPanelOpen,
  } = useTerminalStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { balance, equity, margin_used, currency, isLoading: balanceLoading } = useWalletStore()
  const { accountSummary, isLoading: accountSummaryLoading } = useAccountSummary()
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)

  const displayBalance = balance ?? 0
  const displayEquity = accountSummary?.equity ?? equity ?? 0
  const displayMargin =
    accountSummary?.marginLevel === 'inf'
      ? 0
      : (accountSummary?.marginUsed ?? margin_used ?? 0)
  const loading = balanceLoading || accountSummaryLoading

  const getUserDisplayName = () => {
    if (user?.name) return user.name
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`
    if (user?.email) return user.email
    return 'User'
  }

  const handleLogout = () => {
    logout()
    toast.success('Logged out successfully')
    navigate('/login')
  }

  return (
    <div className="h-full min-h-0 overflow-auto flex flex-col bg-gradient-to-b from-[#0f172a] via-[#0d1524] to-[#0b1220]">
      {/* Header */}
      <div className="shrink-0 px-4 py-4 border-b border-white/5">
        <h2 className="text-lg font-semibold text-text">Account</h2>
        <p className="text-sm text-text-muted mt-0.5">{getUserDisplayName()}</p>
      </div>

      {/* Balance card */}
      <div className="shrink-0 px-4 py-4 space-y-3">
        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Balance</span>
            <span className="text-xs text-text-muted">{currency || 'USD'}</span>
          </div>
          {loading ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <div className="text-2xl font-bold text-text">
              ${displayBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
          <div className="flex justify-between mt-3 pt-3 border-t border-white/10 text-xs">
            <div>
              <span className="text-text-muted">Equity </span>
              {loading ? (
                <Skeleton className="h-4 w-20 inline-block align-middle" />
              ) : (
                <span className="font-semibold text-text">
                  ${displayEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
            <div>
              <span className="text-text-muted">Margin </span>
              {loading ? (
                <Skeleton className="h-4 w-16 inline-block align-middle" />
              ) : (
                <span className="font-semibold text-text">
                  ${displayMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="shrink-0 px-4 py-2">
        <div className="rounded-xl border border-white/10 divide-y divide-white/10">
          <a
            href="/user/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 min-h-[44px] text-text hover:bg-white/5 transition-colors"
          >
            <LayoutDashboard className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium">Dashboard</span>
          </a>
          <button
            type="button"
            onClick={() => setNotificationPanelOpen(true)}
            className="flex items-center gap-3 w-full px-4 py-3 min-h-[44px] text-left text-text hover:bg-white/5 transition-colors"
          >
            <Bell className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium">Notifications</span>
          </button>
          <button
            type="button"
            onClick={() => setPaymentPanelOpen(true)}
            className="flex items-center gap-3 w-full px-4 py-3 min-h-[44px] text-left text-text hover:bg-white/5 transition-colors"
          >
            <CreditCard className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium">Payment history</span>
          </button>
          <button
            type="button"
            onClick={() => setChatPanelOpen(true)}
            className="flex items-center gap-3 w-full px-4 py-3 min-h-[44px] text-left text-text hover:bg-white/5 transition-colors"
          >
            <MessageCircle className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium">Chat</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsPanelOpen(true)}
            className="flex items-center gap-3 w-full px-4 py-3 min-h-[44px] text-left text-text hover:bg-white/5 transition-colors"
          >
            <Settings className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium">Settings</span>
          </button>
        </div>
      </div>

      {/* Deposit / Withdraw */}
      <div className="shrink-0 px-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="success"
            className="w-full min-h-[44px] text-sm font-semibold"
            onClick={() => (onOpenDeposit ? onOpenDeposit() : setDepositModalOpen(true))}
          >
            Deposit
          </Button>
          <Button
            variant="primary"
            className="w-full min-h-[44px] text-sm font-semibold"
            onClick={() => setWithdrawModalOpen(true)}
          >
            Withdraw
          </Button>
        </div>
      </div>

      {/* Logout */}
      <div className="shrink-0 px-4 py-4 mt-auto">
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            'flex items-center gap-3 w-full px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium',
            'text-danger/90 hover:bg-danger/10 transition-colors'
          )}
        >
          <LogOut className="h-5 w-5" />
          Log out
        </button>
      </div>

      {!onOpenDeposit && (
        <DepositModal open={depositModalOpen} onOpenChange={setDepositModalOpen} />
      )}
      <WithdrawModal open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen} />
    </div>
  )
}
