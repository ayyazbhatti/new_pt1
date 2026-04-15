import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getAccessTokenExp, EXPIRY_BUFFER_SEC } from '@/shared/utils/jwt'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  /** Display name - computed from firstName + lastName or set by API */
  name?: string
  role: string
  status: string
  /** Effective permission keys (from API login/me); used by permissions.ts */
  permissions?: string[]
  permissionProfileId?: string | null
  permissionProfileName?: string | null
  /** 'full' | 'close_only' | 'disabled' - trading panel access */
  tradingAccess?: string
  /** Referral code for affiliate / share link */
  referralCode?: string | null
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  isAuthenticated: boolean
  /** True after persist middleware has rehydrated from storage (so tokens are in memory). Not persisted. */
  persistRehydrated: boolean
  isHydrated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => Promise<void>
  setTokens: (accessToken: string, refreshToken: string) => void
  /** Set tokens and clear user so hydrateFromStorage() will fetch user (for impersonation in a new tab). */
  setImpersonationTokens: (accessToken: string, refreshToken: string) => void
  setUser: (user: User) => void
  hydrateFromStorage: () => Promise<void>
  refreshUser: () => Promise<void>
  refreshAccessToken: () => Promise<void>
  /** Returns a valid access token (current or refreshed). Use before WebSocket auth. No polling. */
  ensureValidAccessToken: () => Promise<string | null>
}

export interface RegisterData {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  country?: string
  referralCode?: string
  /** Group ID from signup link (?group=). Legacy. Prefer groupRef. */
  groupId?: string
  /** Signup link ref/slug (?ref=). New user assigned to group with this signup_slug. */
  groupRef?: string
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      persistRehydrated: false,
      isHydrated: false,

      login: async (email: string, password: string) => {
        const { login: loginApi } = await import('@/shared/api/auth.api')
        const response = await loginApi(email, password)
        set({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: {
            id: response.user.id,
            email: response.user.email,
            firstName: response.user.firstName,
            lastName: response.user.lastName,
            role: response.user.role,
            status: response.user.status,
            tradingAccess: response.user.tradingAccess ?? 'full',
            permissions: response.user.permissions,
            permissionProfileId: response.user.permissionProfileId,
            permissionProfileName: response.user.permissionProfileName,
            referralCode: response.user.referralCode,
          },
          isAuthenticated: true,
        })
        scheduleProactiveAccessTokenRefresh()
        // Connect WebSocket after successful login
        if (typeof window !== 'undefined') {
          const { wsClient } = await import('@/shared/ws/wsClient')
          wsClient.connect()
        }
      },

      register: async (data: RegisterData) => {
        const { register: registerApi } = await import('@/shared/api/auth.api')
        const response = await registerApi(data)
        set({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: {
            id: response.user.id,
            email: response.user.email,
            firstName: response.user.firstName,
            lastName: response.user.lastName,
            role: response.user.role,
            status: response.user.status,
            tradingAccess: response.user.tradingAccess ?? 'full',
            permissions: response.user.permissions,
            permissionProfileId: response.user.permissionProfileId,
            permissionProfileName: response.user.permissionProfileName,
            referralCode: response.user.referralCode,
          },
          isAuthenticated: true,
        })
        scheduleProactiveAccessTokenRefresh()
        // Connect WebSocket after successful registration
        if (typeof window !== 'undefined') {
          const { wsClient } = await import('@/shared/ws/wsClient')
          wsClient.connect()
        }
      },

      logout: async () => {
        clearProactiveAccessTokenRefresh()
        const state = get()
        if (state.refreshToken) {
          try {
            const { logout: logoutApi } = await import('@/shared/api/auth.api')
            await logoutApi(state.refreshToken)
          } catch (error: unknown) {
            // Expected when session already expired or refresh token invalid — clear locally only
            const msg = error instanceof Error ? error.message : String(error)
            const isExpected = msg.includes('Invalid refresh token') || msg.includes('Unauthorized') || msg.includes('401')
            if (!isExpected) {
              console.error('Logout error:', error)
            }
          }
        }
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        })
        // Clear legacy token keys so WebSocket fallback never sends a stale token
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token')
          sessionStorage.removeItem('token')
        }
      },

      setTokens: (accessToken: string, refreshToken: string) => {
        set({ accessToken, refreshToken })
        scheduleProactiveAccessTokenRefresh()
        // Re-auth WebSocket with new token when HTTP layer refreshed (e.g. after 401)
        if (typeof window !== 'undefined') {
          import('@/shared/ws/wsClient').then(({ wsClient }) => {
            const state = wsClient.getState()
            if (state === 'connected' || state === 'authenticated') {
              wsClient.reauthenticate()
            }
          })
        }
      },

      setImpersonationTokens: (accessToken: string, refreshToken: string) => {
        set({ accessToken, refreshToken, user: null })
        scheduleProactiveAccessTokenRefresh()
      },

      setUser: (user: User) => {
        set({ user, isAuthenticated: true })
      },

      hydrateFromStorage: async () => {
        const state = get()
        // Whenever we have tokens, refetch user so permissions (and other profile data) are fresh after refresh.
        if (state.accessToken && state.refreshToken) {
          try {
            const { me } = await import('@/shared/api/auth.api')
            const user = await me()
            set({
              user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                status: user.status,
                tradingAccess: user.tradingAccess ?? 'full',
                permissions: user.permissions,
                permissionProfileId: user.permissionProfileId,
                permissionProfileName: user.permissionProfileName,
                referralCode: user.referralCode,
              },
              isAuthenticated: true,
              isHydrated: true,
            })
            if (typeof window !== 'undefined') {
              const { wsClient } = await import('@/shared/ws/wsClient')
              wsClient.connect()
            }
            scheduleProactiveAccessTokenRefresh()
          } catch (error) {
            set({
              accessToken: null,
              refreshToken: null,
              user: null,
              isAuthenticated: false,
              isHydrated: true,
            })
          }
        } else {
          set({ isHydrated: true })
        }
      },

      refreshUser: async () => {
        const state = get()
        if (!state.accessToken) {
          throw new Error('Not authenticated')
        }
        try {
          const { me } = await import('@/shared/api/auth.api')
          const user = await me()
          set({
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role,
              status: user.status,
              tradingAccess: user.tradingAccess ?? 'full',
              permissions: user.permissions,
              permissionProfileId: user.permissionProfileId,
              permissionProfileName: user.permissionProfileName,
              referralCode: user.referralCode,
            },
          })
        } catch (error) {
          console.error('Failed to refresh user:', error)
          throw error
        }
      },

      refreshAccessToken: async () => {
        const state = get()
        if (!state.refreshToken) {
          throw new Error('No refresh token available')
        }
        try {
          const { refresh } = await import('@/shared/api/auth.api')
          const newAccessToken = await refresh(state.refreshToken)
          set({ accessToken: newAccessToken })
          // Also refresh user data to get updated role
          await get().refreshUser()
          // Keep both WebSocket clients on the new JWT (HTTP refresh does not go through setTokens).
          if (typeof window !== 'undefined') {
            const token = get().accessToken
            if (token) {
              const [{ wsClient }, { priceStreamClient }] = await Promise.all([
                import('@/shared/ws/wsClient'),
                import('@/shared/ws/priceStreamClient'),
              ])
              priceStreamClient.setAuthToken(token)
              void wsClient.reauthenticate()
            }
          }
          scheduleProactiveAccessTokenRefresh()
        } catch (error) {
          console.error('Failed to refresh access token:', error)
          throw error
        }
      },

      ensureValidAccessToken: async (): Promise<string | null> => {
        const state = get()
        const token = state.accessToken
        if (!token) return null

        const nowSec = Math.floor(Date.now() / 1000)
        const exp = getAccessTokenExp(token)

        if (!state.refreshToken) {
          if (exp === null) return token
          return exp > nowSec + EXPIRY_BUFFER_SEC ? token : null
        }

        if (exp !== null && exp > nowSec + EXPIRY_BUFFER_SEC) {
          return token
        }

        try {
          await get().refreshAccessToken()
          return get().accessToken ?? null
        } catch {
          return null
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isHydrated = false
        }
        // Signal that persist has finished so guards can safely read tokens / decide auth (avoids new-tab race).
        setTimeout(() => {
          useAuthStore.setState({ persistRehydrated: true })
          scheduleProactiveAccessTokenRefresh()
        }, 0)
      },
    }
  )
)

/** Browser timer handle (avoids NodeJS.Timeout vs number mismatch under @types/node). */
let proactiveAccessTokenTimer: number | null = null

function clearProactiveAccessTokenRefresh(): void {
  if (proactiveAccessTokenTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(proactiveAccessTokenTimer)
  }
  proactiveAccessTokenTimer = null
}

/**
 * One-shot timer to refresh the access token before it expires (no polling loop).
 * Rescheduled after each successful refresh and after login/hydrate.
 */
function scheduleProactiveAccessTokenRefresh(): void {
  clearProactiveAccessTokenRefresh()
  if (typeof window === 'undefined') return

  const { accessToken, refreshToken } = useAuthStore.getState()
  if (!accessToken || !refreshToken) return

  const exp = getAccessTokenExp(accessToken)
  if (exp === null) return

  const nowSec = Math.floor(Date.now() / 1000)
  const triggerSec = exp - EXPIRY_BUFFER_SEC
  let delayMs = (triggerSec - nowSec) * 1000
  if (delayMs < 5_000) delayMs = 5_000
  if (delayMs > 86_400_000) delayMs = 86_400_000

  proactiveAccessTokenTimer = window.setTimeout(() => {
    proactiveAccessTokenTimer = null
    void useAuthStore
      .getState()
      .refreshAccessToken()
      .catch(() => {
        window.setTimeout(() => scheduleProactiveAccessTokenRefresh(), 120_000)
      })
  }, delayMs)
}

