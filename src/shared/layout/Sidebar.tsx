import { NavLink } from 'react-router-dom'
import { useUIStore } from '@/app/store'
import { adminNavItems } from '@/app/config'
import { cn } from '@/shared/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export function Sidebar() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-surface-1 transition-all duration-300',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      {/* Logo/Header - Fixed */}
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {sidebarOpen && <div className="text-lg font-semibold text-text">Admin Panel</div>}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="ml-auto"
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>

      {/* Scrollable Menu */}
      <nav className="flex-1 overflow-y-auto py-4">
        <div className="space-y-1 px-2">
          {adminNavItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text',
                    !sidebarOpen && 'justify-center'
                  )
                }
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </NavLink>
            )
          })}
        </div>
      </nav>

      {/* Footer - Fixed */}
      <div className="border-t border-border p-4">
        {sidebarOpen && (
          <div className="text-xs text-text-muted">Version 1.0.0</div>
        )}
      </div>
    </aside>
  )
}

