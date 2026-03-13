import { useState } from 'react'
import { User, Activity, LogOut, Menu } from 'lucide-react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { toast } from '@/shared/components/common'
import { Button } from '@/shared/ui/button'
import { NotificationBell } from '@/shared/components/NotificationBell'
import { CommandPalette } from '@/shared/components/CommandPalette'
import { useAuthStore } from '@/shared/store/auth.store'
import { useUIStore } from '@/app/store'
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
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const isAdmin = location.pathname.startsWith('/admin')
  const profilePath = isAdmin ? '/admin/profile' : '/user/profile'

  const handleLogout = () => {
    logout()
    toast.success('Logged out successfully')
    navigate('/login')
  }

  return (
    <header className="flex h-14 min-h-[3.5rem] items-center justify-between gap-2 border-b border-border bg-surface-1 px-3 sm:px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
        {/* Mobile: hamburger to open sidebar drawer */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="shrink-0 md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        {isAdmin && (
          <div className="min-w-0 flex-1 max-w-2xl min-w-[280px]">
            <CommandPalette
              open={commandPaletteOpen}
              onOpenChange={setCommandPaletteOpen}
              showTrigger
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {showTerminalLink && (
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="Open Trading Terminal (new tab)"
          >
            <Button variant="ghost" size="sm" type="button" className="p-2 sm:p-2.5">
              <Activity className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          </a>
        )}
        <NotificationBell />
        <Link
          to={profilePath}
          title="Profile"
          className={cn(
            'inline-flex items-center justify-center rounded-lg p-2 text-xs sm:px-3 sm:py-1.5',
            'bg-transparent text-text hover:bg-surface-2 active:bg-surface-2/80'
          )}
        >
          <User className="h-4 w-4 sm:h-5 sm:w-5" />
        </Link>
        {showLogout && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={handleLogout}
            title="Log out"
            className="p-2 text-danger hover:bg-danger/10 sm:p-2.5"
          >
            <LogOut className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        )}
      </div>
    </header>
  )
}

