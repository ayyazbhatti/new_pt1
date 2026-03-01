import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/store/auth.store'

/**
 * Page opened in a new tab with hash #access_token=...&refresh_token=...
 * Applies tokens to auth store, hydrates user, then redirects.
 * Uses setImpersonationTokens (clears user) so hydrateFromStorage fetches the target user.
 */
export function ImpersonatePage() {
  const navigate = useNavigate()
  const setImpersonationTokens = useAuthStore((s) => s.setImpersonationTokens)
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage)
  const isHydrated = useAuthStore((s) => s.isHydrated)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isHydrated) {
      hydrateFromStorage()
      return
    }
    const hash = window.location.hash
    if (!hash) {
      setError('Missing token parameters')
      setStatus('error')
      return
    }
    const params = new URLSearchParams(hash.slice(1).replace(/^#/, ''))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) {
      setError('Invalid token parameters')
      setStatus('error')
      return
    }
    (async () => {
      try {
        setImpersonationTokens(accessToken, refreshToken)
        await hydrateFromStorage()
        const redirectTo = params.get('redirect')
        if (redirectTo && redirectTo.startsWith('/')) {
          navigate(redirectTo, { replace: true })
        } else {
          const user = useAuthStore.getState().user
          const role = user?.role?.toLowerCase()
          const adminRoles = ['admin', 'manager', 'agent']
          if (role && adminRoles.includes(role)) {
            navigate('/admin/dashboard', { replace: true })
          } else {
            navigate('/user/dashboard', { replace: true })
          }
        }
        setStatus('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to sign in as user')
        setStatus('error')
      }
    })()
  }, [isHydrated, setImpersonationTokens, hydrateFromStorage, navigate])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1218] text-white p-6">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/login" className="text-[#4f8cff] hover:underline">
            Return to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1218] text-white p-6">
      <p className="text-slate-400">Signing in as user...</p>
    </div>
  )
}
