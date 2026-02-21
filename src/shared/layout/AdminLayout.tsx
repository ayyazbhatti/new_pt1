import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ModalHost } from './ModalHost'
import { useUIStore } from '@/app/store'
import { cn } from '@/shared/utils'
import { AdminRouteGuard } from '@/shared/components/guards/AdminRouteGuard'

interface AdminLayoutProps {
  children: ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-text">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main
          className={cn(
            'flex-1 overflow-y-auto transition-all duration-300',
            sidebarOpen ? 'ml-0' : 'ml-0'
          )}
        >
          <AdminRouteGuard>{children}</AdminRouteGuard>
        </main>
      </div>
      <ModalHost />
    </div>
  )
}

