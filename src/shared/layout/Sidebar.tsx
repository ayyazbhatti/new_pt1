import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useUIStore } from '@/app/store'
import type { NavItem } from '@/app/config'
import { cn } from '@/shared/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useAuthStore } from '@/shared/store/auth.store'
import { canAccess } from '@/shared/utils/permissions'

export interface SidebarProps {
  /** Nav items to show (e.g. adminNavItems or userNavItems) */
  navItems: NavItem[]
  /** Title shown in sidebar header when expanded (e.g. "Admin Panel" or "User Panel") */
  title: string
}

const MOBILE_BREAKPOINT = 768

export function Sidebar({ navItems, title }: SidebarProps) {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen)
  const user = useAuthStore((state) => state.user)
  const visibleItems = navItems.filter(
    (item) => !item.permission || canAccess(item.permission, user)
  )

  // On mobile, start with drawer closed
  useEffect(() => {
    if (typeof window === 'undefined') return
    const closeOnMobile = () => {
      if (window.innerWidth < MOBILE_BREAKPOINT) setSidebarOpen(false)
    }
    closeOnMobile()
    window.addEventListener('resize', closeOnMobile)
    return () => window.removeEventListener('resize', closeOnMobile)
  }, [setSidebarOpen])

  const closeDrawerOnNavigate = () => {
    if (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT) {
      setSidebarOpen(false)
    }
  }

  return (
    <>
      {/* Mobile overlay – only when sidebar open on small screens */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-surface-1 transition-all duration-300',
          // Mobile: drawer width, desktop: collapsible width
          'w-64 max-w-[85vw] md:max-w-none',
          sidebarOpen ? 'md:w-64' : 'md:w-16',
          // Mobile: slide in/out; desktop: always visible
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          'fixed left-0 top-0 bottom-0 z-50 md:relative'
        )}
      >
        {/* Logo/Header - Fixed */}
        <div className="flex h-14 min-h-[3.5rem] shrink-0 items-center justify-between border-b border-border px-3 sm:px-4">
          {sidebarOpen && (
            <div className="truncate text-base font-semibold text-text sm:text-lg">{title}</div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="ml-auto shrink-0"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>

        {/* Scrollable Menu */}
        <nav className="flex-1 overflow-y-auto scrollbar-sidebar py-3 sm:py-4">
          <div className="space-y-0.5 px-2 sm:space-y-1">
            {visibleItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={closeDrawerOnNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors sm:px-3',
                      isActive
                        ? 'bg-accent text-white'
                        : 'text-text-muted hover:bg-surface-2 hover:text-text',
                      !sidebarOpen && 'justify-center md:justify-center'
                    )
                  }
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {sidebarOpen && <span className="truncate">{item.label}</span>}
                </NavLink>
              )
            })}
          </div>
        </nav>

        {/* Footer - Fixed */}
        <div className="shrink-0 border-t border-border p-3 sm:p-4">
          {sidebarOpen && (
            <div className="text-xs text-text-muted">Version 1.0.0</div>
          )}
        </div>
      </aside>
    </>
  )
}

