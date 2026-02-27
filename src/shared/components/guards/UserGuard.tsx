import { ReactNode, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'

/** Roles that belong to the admin panel; they are redirected away from /user/* */
const ADMIN_PANEL_ROLES = ['admin', 'manager', 'agent']

interface UserGuardProps {
  children: ReactNode
}

/**
 * Protects user panel routes: requires authenticated user and non-admin role.
 * - Not authenticated → redirect to /login
 * - Authenticated as admin/manager/agent → redirect to /admin/dashboard (they use admin panel)
 * - Otherwise (e.g. role "user") → allow access to /user/*
 */
export function UserGuard({ children }: UserGuardProps) {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isHydrated = useAuthStore((state) => state.isHydrated)
  const hydrateFromStorage = useAuthStore((state) => state.hydrateFromStorage)
  const location = useLocation()

  useEffect(() => {
    if (!isHydrated) {
      hydrateFromStorage()
    }
  }, [isHydrated, hydrateFromStorage])

  if (!isHydrated) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-text-muted">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const role = user?.role?.toLowerCase()
  if (role && ADMIN_PANEL_ROLES.includes(role)) {
    return <Navigate to="/admin/dashboard" replace />
  }

  return <>{children}</>
}
