import { useState, useCallback, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@/shared/utils'
import { Input } from '@/shared/ui'
import { getMyChat, sendChatMessage } from '../api/chat.api'
import { wsClient } from '@/shared/ws/wsClient'
import { useAuthStore } from '@/shared/store/auth.store'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'

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

interface SupportChatTabProps {
  active: boolean
}

export function SupportChatTab({ active }: SupportChatTabProps) {
  const userId = useAuthStore((s) => s.user?.id)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const knownIds = useRef<Set<string>>(new Set())
  const messageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!userId || !active) return
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
  }, [userId, active])

  useEffect(() => {
    if (!active || !userId) return
    setError(null)
    setLoading(true)
    getMyChat()
      .then((list) => {
        const msgs = list.map(dtoToMessage)
        setMessages(msgs)
        knownIds.current = new Set(msgs.map((m) => m.id))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chat'))
      .finally(() => setLoading(false))
  }, [active, userId])

  useEffect(() => {
    if (!userId || !active) return
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
  }, [userId, active])

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

  return (
    <>
      <div className="flex-1 min-h-0 overflow-auto">
        <SupportMessageList error={error} loading={loading} messages={messages} />
      </div>
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
    </>
  )
}

function SupportMessageList({
  error,
  loading,
  messages,
}: {
  error: string | null
  loading: boolean
  messages: ChatMessage[]
}) {
  return (
    <div className="px-3 py-4 space-y-3">
      {error && <p className="text-xs text-red-400/90 px-2">{error}</p>}
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
            <SupportMessageBubble msg={msg} />
          </div>
        ))
      )}
    </div>
  )
}

function SupportMessageBubble({ msg }: { msg: ChatMessage }) {
  return (
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
  )
}
