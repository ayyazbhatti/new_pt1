import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  isAuthenticated: boolean
  isHydrated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => Promise<void>
  setTokens: (accessToken: string, refreshToken: string) => void
  setUser: (user: User) => void
  hydrateFromStorage: () => Promise<void>
  refreshUser: () => Promise<void>
  refreshAccessToken: () => Promise<void>
}

export interface RegisterData {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  country?: string
  referralCode?: string
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
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
          },
          isAuthenticated: true,
        })
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
          },
          isAuthenticated: true,
        })
      },

      logout: async () => {
        const state = get()
        if (state.refreshToken) {
          try {
            const { logout: logoutApi } = await import('@/shared/api/auth.api')
            await logoutApi(state.refreshToken)
          } catch (error) {
            // Ignore logout errors
            console.error('Logout error:', error)
          }
        }
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        })
      },

      setTokens: (accessToken: string, refreshToken: string) => {
        set({ accessToken, refreshToken })
      },

      setUser: (user: User) => {
        set({ user, isAuthenticated: true })
      },

      hydrateFromStorage: async () => {
        const state = get()
        if (state.accessToken && state.refreshToken && !state.user) {
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
              },
              isAuthenticated: true,
              isHydrated: true,
            })
          } catch (error) {
            // Token invalid, clear state
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
        } catch (error) {
          console.error('Failed to refresh access token:', error)
          throw error
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
      },
    }
  )
)

