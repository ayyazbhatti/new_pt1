import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ModalHost } from './ModalHost'
import { useUIStore } from '@/app/store'
import { cn } from '@/shared/utils'
import { userNavItems } from '@/app/config'

interface UserLayoutProps {
  children: ReactNode
}

export function UserLayout({ children }: UserLayoutProps) {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-text">
      <Sidebar navItems={userNavItems} title="User Panel" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar showTerminalLink showLogout />
        <main
          className={cn(
            'flex-1 overflow-y-auto transition-all duration-300',
            sidebarOpen ? 'ml-0' : 'ml-0'
          )}
        >
          {children}
        </main>
      </div>
      <ModalHost />
    </div>
  )
}
