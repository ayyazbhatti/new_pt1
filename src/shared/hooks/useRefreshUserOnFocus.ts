import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/shared/store/auth.store'

const THROTTLE_MS = 60_000 // At most one refresh per 60s when tab becomes visible (no polling)

/**
 * When the tab becomes visible, refresh the current user (and permissions) once per throttle window.
 * Event-driven only: no setInterval, no polling. Used so permission profile changes take effect
 * after the user returns to the tab.
 */
export function useRefreshUserOnFocus() {
  const lastRefreshAt = useRef<number>(0)

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const state = useAuthStore.getState()
      if (!state.accessToken || !state.user) return
      const now = Date.now()
      if (now - lastRefreshAt.current < THROTTLE_MS) return
      lastRefreshAt.current = now
      state.refreshUser().catch((e) => console.error('Failed to refresh user on focus', e))
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])
}
