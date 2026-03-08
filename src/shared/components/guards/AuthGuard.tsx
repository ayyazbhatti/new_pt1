import { ReactNode, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'
import { UserCallProvider } from '@/features/call/UserCallProvider'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isHydrated, persistRehydrated, hydrateFromStorage, user } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (persistRehydrated && !isHydrated) {
      hydrateFromStorage()
    }
  }, [persistRehydrated, isHydrated, hydrateFromStorage])

  // Wait for persist rehydration so we don't treat the user as unauthenticated before tokens are in memory (e.g. new tab).
  if (!persistRehydrated || !isHydrated) {
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

  // Incoming-call UI for non-admin users (so they see the ring modal from any page: terminal, trading, user panel)
  const showCallProvider = user?.role === 'user'

  return (
    <>
      {children}
      {showCallProvider && <UserCallProvider />}
    </>
  )
}

