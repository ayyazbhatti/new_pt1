import { useState, useRef, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { useNotificationsStore } from '@/shared/store/notificationsStore'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWebSocketSubscription } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { cn } from '@/shared/utils'

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { items, unreadCount, markRead, markAllRead, loadNotifications, push } = useNotificationsStore()
  const { user } = useAuthStore()

  // Load notifications on mount
  useEffect(() => {
    if (user?.id) {
      loadNotifications()
    }
  }, [user?.id, loadNotifications])

  // Subscribe to notification.push WebSocket events
  useWebSocketSubscription((event: WsInboundEvent) => {
    if (event.type === 'notification.push') {
      push(event.payload)
    }
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-surface-2 transition-colors"
        title="Notifications"
      >
        <Bell className="h-5 w-5 text-text" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-danger text-white text-xs font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border bg-surface-1 shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-accent hover:text-accent/80"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">
                No notifications
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'p-4 hover:bg-surface-2/50 transition-colors cursor-pointer',
                      !item.read && 'bg-surface-2/30'
                    )}
                    onClick={() => {
                      if (!item.read) {
                        markRead(item.id)
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full mt-2 flex-shrink-0',
                          !item.read ? 'bg-accent' : 'bg-transparent'
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text">{item.title}</div>
                        <div className="text-xs text-text-muted mt-1">{item.message}</div>
                        <div className="text-xs text-text-muted/70 mt-1">
                          {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
