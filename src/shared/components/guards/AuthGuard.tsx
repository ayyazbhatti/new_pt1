import { ReactNode, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isHydrated, hydrateFromStorage } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (!isHydrated) {
      hydrateFromStorage()
    }
  }, [isHydrated, hydrateFromStorage])

  // Show loading while hydrating
  if (!isHydrated) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-text-muted">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    // Redirect to login, preserving the intended destination
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

