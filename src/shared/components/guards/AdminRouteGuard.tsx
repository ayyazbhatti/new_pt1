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
 * Admin and manager are treated the same: both require the assigned permission for the path.
 */
export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)

  const pathname = location.pathname
  const requiredPermission = ADMIN_ROUTE_PERMISSIONS[pathname]

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!requiredPermission) {
    return <>{children}</>
  }

  if (canAccess(requiredPermission, user)) {
    return <>{children}</>
  }

  return <AccessDenied />
}
