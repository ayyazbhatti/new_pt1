import { useEffect } from 'react'
import { X, Bell, ArrowLeft } from 'lucide-react'
import { useMediaQuery } from '@/shared/hooks'
import { useTerminalStore } from '../store'
import { useNotificationsStore } from '@/shared/store/notificationsStore'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useAuthStore } from '@/shared/store/auth.store'
import { cn } from '@/shared/utils'
import type { NotificationPushPayload } from '@/shared/ws/wsEvents'

const PANEL_WIDTH_DESKTOP = 288

/** Format ISO date to relative time (e.g. "2 min ago", "1 hour ago") */
function formatRelativeTime(createdAt: string): string {
  try {
    const date = new Date(createdAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    if (diffSec < 60) return 'Just now'
    if (diffMin < 60) return `${diffMin} min ago`
    if (diffHour < 24) return `${diffHour} hour ago`
    if (diffDay === 1) return 'Yesterday'
    if (diffDay < 7) return `${diffDay} days ago`
    return date.toLocaleDateString()
  } catch {
    return ''
  }
}

/** Map API kind to display type for badge styling */
function getKindType(kind: NotificationPushPayload['kind']): 'order' | 'sl' | 'deposit' | 'system' {
  if (kind === 'POSITION_SL' || kind === 'POSITION_LIQUIDATED') return 'sl'
  if (kind === 'POSITION_TP') return 'order'
  if (kind === 'DEPOSIT_REQUEST' || kind === 'DEPOSIT_APPROVED' || kind === 'WITHDRAWAL_APPROVED') return 'deposit'
  if (kind === 'ADMIN_MESSAGE') return 'system'
  return 'system'
}

function getTypeColor(type: 'order' | 'sl' | 'deposit' | 'system'): string {
  switch (type) {
    case 'order':
      return 'bg-accent/10 text-accent'
    case 'sl':
      return 'bg-danger/10 text-danger'
    case 'deposit':
      return 'bg-success/10 text-success'
    default:
      return 'bg-surface-2 text-text-muted'
  }
}

function getTypeLabel(kind: NotificationPushPayload['kind']): string {
  if (kind === 'POSITION_SL') return 'SL'
  if (kind === 'POSITION_TP') return 'TP'
  if (kind === 'POSITION_LIQUIDATED') return 'LIQ'
  if (kind === 'ADMIN_MESSAGE') return 'Msg'
  if (kind === 'DEPOSIT_REQUEST' || kind === 'DEPOSIT_APPROVED') return 'D'
  if (kind === 'WITHDRAWAL_APPROVED') return 'W'
  return '!'
}

export function NotificationsPanel() {
  const { notificationPanelOpen, setNotificationPanelOpen } = useTerminalStore()
  const { user } = useAuthStore()
  const isMobile = !useMediaQuery('(min-width: 1024px)')
  const {
    items,
    unreadCount,
    isLoading,
    loadNotifications,
    markRead,
    markAllRead,
    push,
  } = useNotificationsStore()

  // Load real notifications when user is present and panel is open
  useEffect(() => {
    if (user?.id && notificationPanelOpen) {
      loadNotifications()
    }
  }, [user?.id, notificationPanelOpen, loadNotifications])

  // Real-time: subscribe to notification.push (terminal has no Topbar/NotificationBell, so we need this)
  useWebSocketSubscription((event: WsInboundEvent) => {
    if (event.type === 'notification.push') push(event.payload)
  })

  if (!notificationPanelOpen) return null

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col',
        isMobile ? 'w-full bg-background' : 'shrink-0 bg-background/95 backdrop-blur-sm border-l border-white/10 shadow-[-4px_0_24px_rgba(0,0,0,0.25)]',
        'animate-fade-in'
      )}
      style={isMobile ? undefined : { width: PANEL_WIDTH_DESKTOP }}
      role="dialog"
      aria-label={isMobile ? 'Notifications page' : 'Notifications panel'}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/10 bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          {isMobile ? (
            <button
              type="button"
              onClick={() => setNotificationPanelOpen(false)}
              className="shrink-0 p-2 -ml-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Bell className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-text truncate">Notifications</h2>
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-accent hover:text-accent/80"
            >
              Mark all read
            </button>
          )}
          {!isMobile && (
            <button
              type="button"
              onClick={() => setNotificationPanelOpen(false)}
              className="shrink-0 p-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              title="Close panel"
              aria-label="Close notifications panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-4 py-3 space-y-1">
          {isLoading ? (
            <p className="text-sm text-text-muted py-6 text-center">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">No notifications yet.</p>
          ) : (
            items.map((n) => {
              const type = getKindType(n.kind)
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.read && markRead(n.id)}
                  className={cn(
                    'w-full text-left rounded-lg px-3 py-2.5 border transition-colors',
                    n.read
                      ? 'bg-transparent border-transparent hover:bg-white/5'
                      : 'bg-white/5 border-white/10'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'shrink-0 mt-0.5 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold',
                        getTypeColor(type)
                      )}
                    >
                      {getTypeLabel(n.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text">{n.title}</p>
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-text-muted/70 mt-1">
                        {formatRelativeTime(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
