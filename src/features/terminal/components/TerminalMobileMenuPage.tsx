import { X, LayoutDashboard, Bell, CreditCard, MessageCircle, Settings, User, LogOut, Wallet } from 'lucide-react'
import { useTerminalStore } from '../store/terminalStore'
import { useAuthStore } from '@/shared/store/auth.store'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/shared/components/common'
import { cn } from '@/shared/utils'

interface TerminalMobileMenuPageProps {
  onClose: () => void
  onOpenDeposit?: () => void
}

/**
 * Full-screen mobile menu page (hamburger). Professional menu with navigation and actions.
 * Replaces the symbol sidebar panel when hamburger is clicked on mobile.
 */
export function TerminalMobileMenuPage({ onClose, onOpenDeposit }: TerminalMobileMenuPageProps) {
  const {
    setMobileTab,
    setNotificationPanelOpen,
    setPaymentPanelOpen,
    setChatPanelOpen,
    setSettingsPanelOpen,
  } = useTerminalStore()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const getUserDisplayName = () => {
    if (user?.name) return user.name
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`
    if (user?.email) return user.email
    return 'Account'
  }

  const handleLogout = () => {
    onClose()
    logout()
    toast.success('Logged out successfully')
    navigate('/login')
  }

  const closeAnd = (fn: () => void) => {
    onClose()
    fn()
  }

  const menuItems = [
    ...(onOpenDeposit
      ? [
          {
            id: 'deposit',
            label: 'Deposit',
            icon: Wallet,
            onClick: () => closeAnd(() => onOpenDeposit()),
          },
        ]
      : []),
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      onClick: () => closeAnd(() => window.open('/user/dashboard', '_blank')),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      onClick: () => closeAnd(() => setNotificationPanelOpen(true)),
    },
    {
      id: 'payment',
      label: 'Payment history',
      icon: CreditCard,
      onClick: () => closeAnd(() => setPaymentPanelOpen(true)),
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageCircle,
      onClick: () => closeAnd(() => setChatPanelOpen(true)),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      onClick: () => closeAnd(() => setSettingsPanelOpen(true)),
    },
    {
      id: 'account',
      label: 'Account',
      icon: User,
      onClick: () => closeAnd(() => setMobileTab('account')),
    },
  ]

  return (
    <div className="h-full min-h-[100dvh] w-full flex flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-4 border-b border-white/5">
        <h1 className="text-lg font-semibold text-text">Menu</h1>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* User / Account summary line */}
      <div className="shrink-0 px-4 py-3 border-b border-white/5">
        <p className="text-sm text-muted">Signed in as</p>
        <p className="text-base font-medium text-text mt-0.5 truncate">{getUserDisplayName()}</p>
      </div>

      {/* Menu list */}
      <nav className="flex-1 overflow-auto py-4">
        <div className="px-4">
          <ul className="rounded-xl border border-white/10 overflow-hidden divide-y divide-white/10">
            {menuItems.map(({ id, label, icon: Icon, onClick }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={onClick}
                  className="flex items-center gap-3 w-full px-4 py-3.5 min-h-[52px] text-left text-text hover:bg-white/5 active:bg-white/10 transition-colors"
                >
                  <Icon className="h-5 w-5 text-muted shrink-0" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Log out */}
        <div className="px-4 mt-6">
          <button
            type="button"
            onClick={handleLogout}
            className={cn(
              'flex items-center gap-3 w-full px-4 py-3.5 min-h-[52px] rounded-xl text-sm font-medium',
              'text-danger/90 hover:bg-danger/10 active:bg-danger/15 transition-colors'
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Log out
          </button>
        </div>
      </nav>
    </div>
  )
}
