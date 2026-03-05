import { Search, User, Activity, LogOut } from 'lucide-react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { toast } from '@/shared/components/common'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { NotificationBell } from '@/shared/components/NotificationBell'
import { useAuthStore } from '@/shared/store/auth.store'
import { cn } from '@/shared/utils'

interface TopbarProps {
  /** When true, show an icon that opens the trading terminal (/) in a new tab. Used in user panel. */
  showTerminalLink?: boolean
  /** When true, show logout icon. Used in user panel (same behaviour as terminal sidebar logout). */
  showLogout?: boolean
}

export function Topbar({ showTerminalLink, showLogout }: TopbarProps = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((state) => state.logout)
  const isAdmin = location.pathname.startsWith('/admin')
  const profilePath = isAdmin ? '/admin/profile' : '/user/profile'

  const handleLogout = () => {
    logout()
    toast.success('Logged out successfully')
    navigate('/login')
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface-1 px-6">
      <div className="flex items-center gap-4 flex-1">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search..."
            className="pl-10"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {showTerminalLink && (
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="Open Trading Terminal (new tab)"
          >
            <Button variant="ghost" size="sm" type="button">
              <Activity className="h-5 w-5" />
            </Button>
          </a>
        )}
        <NotificationBell />
        <Link
          to={profilePath}
          title="Profile"
          className={cn(
            'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs',
            'bg-transparent text-text hover:bg-surface-2 active:bg-surface-2/80'
          )}
        >
          <User className="h-5 w-5" />
        </Link>
        {showLogout && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={handleLogout}
            title="Log out"
            className="text-danger hover:text-danger hover:bg-danger/10"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        )}
      </div>
    </header>
  )
}

