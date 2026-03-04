import { useState, useCallback, useEffect, useRef } from 'react'
import { X, MessageCircle, Send } from 'lucide-react'
import { useTerminalStore } from '../store'
import { cn } from '@/shared/utils'
import { Input } from '@/shared/ui'
import { getMyChat, sendChatMessage } from '../api/chat.api'
import { wsClient } from '@/shared/ws/wsClient'
import { useAuthStore } from '@/shared/store/auth.store'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'

const useWsState = () => {
  const [state, setState] = useState(wsClient.getState())
  useEffect(() => {
    return wsClient.onStateChange(setState)
  }, [])
  return state
}

const PANEL_WIDTH = 288

type ChatMessage = { id: string; sender: 'support' | 'user'; name: string; text: string; time: string }

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

function dtoToMessage(dto: { id: string; senderType: string; body: string; createdAt: string }): ChatMessage {
  const sender = dto.senderType === 'user' ? 'user' : 'support'
  return {
    id: dto.id,
    sender,
    name: sender === 'user' ? 'You' : 'Support',
    text: dto.body,
    time: formatTime(dto.createdAt),
  }
}

export function ChatPanel() {
  const { chatPanelOpen, setChatPanelOpen } = useTerminalStore()
  const userId = useAuthStore((s) => s.user?.id)
  const wsState = useWsState()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const knownIds = useRef<Set<string>>(new Set())
  const messageInputRef = useRef<HTMLInputElement>(null)

  // Ensure WebSocket is connected when chat is relevant (so we receive support replies in real time)
  useEffect(() => {
    if (!userId || !chatPanelOpen) return
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
  }, [userId, chatPanelOpen])

  // Load history when panel opens
  useEffect(() => {
    if (!chatPanelOpen || !userId) return
    setError(null)
    setLoading(true)
    getMyChat()
      .then((list) => {
        const msgs = list.map(dtoToMessage)
        setMessages(msgs)
        msgs.forEach((m) => knownIds.current.add(m.id))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chat'))
      .finally(() => setLoading(false))
  }, [chatPanelOpen, userId])

  // Real-time: new messages for this user (support replies or own echo)
  useEffect(() => {
    if (!userId) return
    console.log('[ChatPanel] Registered WS handler for real-time chat (userId:', userId, ')')
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      const e = event as Record<string, unknown>
      const payload = (e.payload ?? e) as Record<string, unknown>
      if (!payload || typeof payload.body !== 'string') return
      const payloadUserId = (payload.userId ?? payload.user_id) as string | undefined
      if (!payloadUserId || payloadUserId !== userId) return
      const id = (payload.id as string) || ''
      if (!id || knownIds.current.has(id)) return
      knownIds.current.add(id)
      const dto = {
        id,
        senderType: (payload.senderType ?? payload.sender_type ?? 'support') as string,
        body: (payload.body as string) ?? '',
        createdAt: (payload.createdAt ?? payload.created_at ?? new Date().toISOString()) as string,
      }
      setMessages((prev) => [...prev, dtoToMessage(dto)])
    })
    return unsubscribe
  }, [userId])

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !userId || sending) return
    setSending(true)
    setInputValue('')
    try {
      const created = await sendChatMessage(trimmed)
      if (!knownIds.current.has(created.id)) {
        knownIds.current.add(created.id)
        setMessages((prev) => [...prev, dtoToMessage(created)])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
      setInputValue(trimmed)
    } finally {
      setSending(false)
      requestAnimationFrame(() => messageInputRef.current?.focus())
    }
  }, [inputValue, userId, sending])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  if (!chatPanelOpen) return null

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col shrink-0',
        'bg-background/95 backdrop-blur-sm',
        'border-l border-white/10 shadow-[-4px_0_24px_rgba(0,0,0,0.25)]',
        'animate-fade-in'
      )}
      style={{ width: PANEL_WIDTH }}
      role="dialog"
      aria-label="Chat panel"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/10 bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <MessageCircle className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-text truncate">Chat</h2>
          <span
            className={cn(
              'shrink-0 text-[10px] px-1.5 py-0.5 rounded',
              wsState === 'authenticated'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/20 text-amber-400'
            )}
            title={wsState === 'authenticated' ? 'Realtime connected' : `Realtime: ${wsState}`}
          >
            {wsState === 'authenticated' ? 'Live' : wsState === 'connecting' || wsState === 'connected' ? '…' : 'Off'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setChatPanelOpen(false)}
          className="shrink-0 p-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
          title="Close panel"
          aria-label="Close chat panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chat thread */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-3 py-4 space-y-3">
          {error && (
            <p className="text-xs text-red-400/90 px-2">{error}</p>
          )}
          {loading ? (
            <p className="text-xs text-text-muted px-2">Loading...</p>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex flex-col max-w-[92%]',
                  msg.sender === 'user' ? 'items-end ml-auto' : 'items-start'
                )}
              >
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs',
                    msg.sender === 'user'
                      ? 'bg-accent/20 text-text border border-accent/30'
                      : 'bg-white/5 text-text/90 border border-white/10'
                  )}
                >
                  <p className="text-sm leading-snug">{msg.text}</p>
                  <div className="font-medium text-[10px] uppercase tracking-wider text-text-muted mt-1.5 text-right">
                    {msg.name} · {msg.time}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Message input */}
      <div className="shrink-0 px-3 py-3 border-t border-white/10 bg-background/80">
        <div className="flex items-center gap-2">
          <Input
            ref={messageInputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 min-w-0 h-9 text-sm bg-white/5 border-white/10 focus-visible:ring-accent/50"
            aria-label="Chat message"
            disabled={sending}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || sending}
            className="shrink-0 p-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            title="Send message"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
