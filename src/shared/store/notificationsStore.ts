import { create } from 'zustand'
import { NotificationPushPayload } from '../ws/wsEvents'
import { fetchNotifications } from '../api/notifications.api'

export type Notification = NotificationPushPayload

interface NotificationsState {
  items: Notification[]
  unreadCount: number
  isLoading: boolean
  push: (notification: Notification) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
  loadNotifications: () => Promise<void>
  setLoading: (loading: boolean) => void
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  unreadCount: 0,
  isLoading: false,

  push: (notification: Notification) => {
    const state = get()
    const id = notification?.id
    if (!id || state.items.some((item) => item.id === id)) return
    // For SL/TP, also dedupe by content (same position + message = same event, avoid duplicate display)
    if (
      (notification.kind === 'POSITION_SL' || notification.kind === 'POSITION_TP') &&
      notification.meta?.positionId != null
    ) {
      const already = state.items.some(
        (item) =>
          (item.kind === 'POSITION_SL' || item.kind === 'POSITION_TP') &&
          item.meta?.positionId === notification.meta?.positionId &&
          item.message === notification.message
      )
      if (already) return
    }
    set({
      items: [notification, ...state.items],
      unreadCount: state.unreadCount + 1,
    })
  },

  markRead: (id: string) => {
    set((state) => {
      const item = state.items.find((item) => item.id === id)
      if (item && !item.read) {
        return {
          items: state.items.map((item) =>
            item.id === id ? { ...item, read: true } : item
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        }
      }
      return state
    })
  },

  markAllRead: () => {
    set((state) => ({
      items: state.items.map((item) => ({ ...item, read: true })),
      unreadCount: 0,
    }))
  },

  clear: () => {
    set({ items: [], unreadCount: 0 })
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading })
  },

  loadNotifications: async () => {
    const state = get()
    if (state.isLoading) return

    set({ isLoading: true })
    try {
      const response = await fetchNotifications()
      const raw = response.items || []
      // Dedupe SL/TP by (kind, positionId, message) so we never show two for the same close event
      const seen = new Set<string>()
      const items = raw.filter((n) => {
        if ((n.kind === 'POSITION_SL' || n.kind === 'POSITION_TP') && n.meta?.positionId != null) {
          const key = `${n.kind}:${n.meta.positionId}:${n.message}`
          if (seen.has(key)) return false
          seen.add(key)
        }
        return true
      })
      const unreadCount = items.filter((n) => !n.read).length
      set({ items, unreadCount })
    } catch (error: any) {
      const status = error?.response?.status
      // 401 = session expired or invalid; auth store will clear and redirect to login — don't log as error
      if (status === 401) {
        set({ items: [], unreadCount: 0 })
        return
      }
      // Gracefully handle 404/500 - endpoint not implemented yet or server error
      if (status === 404 || status === 500) {
        if (import.meta.env.DEV) {
          console.debug('Notifications endpoint not available yet. Backend implementation pending.')
        }
        set({ items: [], unreadCount: 0 })
      } else {
        console.error('Failed to load notifications:', error)
      }
      // Don't show toast - notifications are not critical
    } finally {
      set({ isLoading: false })
    }
  },
}))
