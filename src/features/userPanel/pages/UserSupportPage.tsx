import { useState, useCallback, useEffect, useRef } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { MessageCircle, Send, Loader2 } from 'lucide-react'
import { cn } from '@/shared/utils'
import { getMyChat, sendChatMessage } from '@/features/terminal/api/chat.api'
import { wsClient } from '@/shared/ws/wsClient'
import { useAuthStore } from '@/shared/store/auth.store'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'

function useWsState() {
  const [state, setState] = useState(wsClient.getState())
  useEffect(() => {
    return wsClient.onStateChange(setState)
  }, [])
  return state
}

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

export function UserSupportPage() {
  const userId = useAuthStore((s) => s.user?.id)
  const wsState = useWsState()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const knownIds = useRef<Set<string>>(new Set())
  const messageInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ensure WebSocket is connected so we receive support replies in real time
  useEffect(() => {
    if (!userId) return
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
  }, [userId])

  // Load chat history on mount
  useEffect(() => {
    if (!userId) return
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
  }, [userId])

  // Real-time: new messages for this user (support replies or own echo)
  useEffect(() => {
    if (!userId) return
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

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  return (
    <ContentShell className="flex flex-col flex-1 min-h-0 p-0 max-w-none w-full">
      <div className="flex flex-col flex-1 min-h-0 px-6 pt-6">
        <PageHeader
          title="Support"
          description="Chat with support. Messages are delivered in real time when you're online."
        />
        <div className="mt-3 flex items-center gap-2 shrink-0">
          <span
            className={cn(
              'text-[10px] px-2 py-1 rounded font-medium',
              wsState === 'authenticated'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/20 text-amber-400'
            )}
            title={wsState === 'authenticated' ? 'Realtime connected' : `Realtime: ${wsState}`}
          >
            {wsState === 'authenticated' ? 'Live' : wsState === 'connecting' || wsState === 'connected' ? 'Connecting…' : 'Off'}
          </span>
        </div>
        <Card className="flex flex-col flex-1 min-h-0 overflow-hidden mt-3 w-full">
          {/* Chat thread */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-auto p-4 space-y-3"
          >
            {error && (
              <p className="text-xs text-red-400/90 px-2">{error}</p>
            )}
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading chat…</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted">
                <MessageCircle className="h-10 w-10 mb-3 opacity-50" />
                <p className="text-sm font-medium">No messages yet</p>
                <p className="text-xs mt-1">Send a message to start a conversation with support.</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex flex-col max-w-[85%]',
                    msg.sender === 'user' ? 'items-end ml-auto' : 'items-start'
                  )}
                >
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 text-xs',
                      msg.sender === 'user'
                        ? 'bg-accent/20 text-text border border-accent/30'
                        : 'bg-surface-2 text-text/90 border border-border'
                    )}
                  >
                    <p className="text-sm leading-snug whitespace-pre-wrap">{msg.text}</p>
                    <div className="font-medium text-[10px] uppercase tracking-wider text-text-muted mt-1.5 text-right">
                      {msg.name} · {msg.time}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Message input */}
          <div className="shrink-0 p-4 border-t border-border bg-surface/50">
            <div className="flex items-center gap-2">
              <Input
                ref={messageInputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 min-w-0 h-10 text-sm"
                aria-label="Chat message"
                disabled={sending}
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || sending}
                className="shrink-0 p-2.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                title="Send message"
                aria-label="Send message"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </ContentShell>
  )
}
