import { ReactNode } from 'react'
import { useLocation, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'
import { canAccess, ADMIN_ROUTE_PERMISSIONS } from '@/shared/utils/permissions'
import { AccessDenied } from '@/features/auth/components/AccessDenied'

interface AdminRouteGuardProps {
  children: ReactNode
}

/**
 * Renders children if the current admin route is allowed by the user's permissions.
 * Admin role always passes. Manager/agent must have the required permission for the path.
 */
export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)

  const pathname = location.pathname
  const requiredPermission = ADMIN_ROUTE_PERMISSIONS[pathname]

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const isAdmin = user.role?.toLowerCase() === 'admin'
  if (isAdmin) {
    return <>{children}</>
  }

  if (!requiredPermission) {
    return <>{children}</>
  }

  if (canAccess(requiredPermission, user)) {
    return <>{children}</>
  }

  return <AccessDenied />
}
