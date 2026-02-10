import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'

interface AdminGuardProps {
  children: ReactNode
}

export function AdminGuard({ children }: AdminGuardProps) {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isHydrated = useAuthStore((state) => state.isHydrated)

  // Wait for hydration (AuthGuard handles this, but just in case)
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

  if (user?.role !== 'admin') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-text mb-2">Access Denied</h1>
          <p className="text-text-muted mb-4">You do not have permission to access this page.</p>
          <div className="bg-surface-2 rounded-lg p-4 mb-4 text-left">
            <p className="text-sm text-text-dim mb-1">
              <span className="font-medium">Current user:</span> {user?.email || 'Unknown'}
            </p>
            <p className="text-sm text-text-dim mb-1">
              <span className="font-medium">Current role:</span> {user?.role || 'Unknown'}
            </p>
            <p className="text-sm text-text-dim">
              <span className="font-medium">Required role:</span> admin
            </p>
          </div>
          <button
            onClick={async () => {
              await useAuthStore.getState().logout()
              window.location.href = '/login'
            }}
            className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
          >
            Log out and sign in with admin account
          </button>
          <p className="text-xs text-text-dim mt-4">
            Admin credentials: admin@newpt.local / Admin@12345
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

