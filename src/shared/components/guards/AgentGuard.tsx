import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'

const ALLOWED_ROLES = ['admin', 'super_admin', 'manager', 'agent']

interface AgentGuardProps {
  children: ReactNode
}

export function AgentGuard({ children }: AgentGuardProps) {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isHydrated = useAuthStore((state) => state.isHydrated)

  if (!isHydrated) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-text-muted">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  const role = user?.role?.toLowerCase()
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-text mb-2">Access Denied</h1>
          <p className="text-text-muted">You do not have permission to access the agent area.</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
