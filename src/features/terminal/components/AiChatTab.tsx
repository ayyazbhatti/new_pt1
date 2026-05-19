import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/shared/utils'
import { Input } from '@/shared/ui'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import {
  clearAiConversation,
  getAiConversation,
  getAiUsage,
  sendAiMessage,
  type AiMessageDto,
} from '@/features/aiChat/api/aiChat.api'
import { wsClient } from '@/shared/ws/wsClient'
import { useAuthStore } from '@/shared/store/auth.store'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'

type AiUiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  time: string
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

function dtoToUi(m: AiMessageDto): AiUiMessage {
  const role = m.role === 'user' ? 'user' : 'assistant'
  return {
    id: m.id,
    role,
    content: m.content,
    streaming: false,
    time: formatTime(m.createdAt),
  }
}

/** Prefer API text when present; never replace in-flight UI with an empty DB row mid-generation. */
function mergeApiWithLocal(prev: AiUiMessage[], api: AiMessageDto[]): AiUiMessage[] {
  const apiUi = api.map(dtoToUi)
  const prevById = new Map(prev.map((m) => [m.id, m]))
  const merged = apiUi.map((apiMsg) => {
    const local = prevById.get(apiMsg.id)
    if (!local) return apiMsg

    const apiHasText = apiMsg.content.trim().length > 0
    // Backend inserts assistant row with '' before streaming finishes — ignore that snapshot.
    if (local.streaming && !apiHasText) {
      return local
    }

    const content = apiHasText ? apiMsg.content : local.content
    return {
      ...apiMsg,
      content,
      streaming: apiHasText ? false : local.streaming,
    }
  })
  const apiIds = new Set(apiUi.map((m) => m.id))
  const extras = prev.filter((m) => !apiIds.has(m.id) && !m.id.startsWith('temp-'))
  return [...merged, ...extras]
}

interface AiChatTabProps {
  active: boolean
}

export function AiChatTab({ active }: AiChatTabProps) {
  const userId = useAuthStore((s) => s.user?.id)
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<AiUiMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conversationIdRef = useRef<string | null>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const syncTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearSyncTimeouts = useCallback(() => {
    for (const id of syncTimeoutsRef.current) clearTimeout(id)
    syncTimeoutsRef.current = []
  }, [])

  /** Force-fetch conversation from API and merge into UI (bypasses stale React Query cache). */
  const refreshConversationFromServer = useCallback(
    async (assistantMessageId?: string): Promise<boolean> => {
      try {
        const conv = await queryClient.fetchQuery({
          queryKey: ['ai', 'conversation'],
          queryFn: getAiConversation,
        })
        if (conv.conversationId) {
          conversationIdRef.current = conv.conversationId
        }
        setMessages((prev) => mergeApiWithLocal(prev, conv.messages))
        if (assistantMessageId) {
          const row = conv.messages.find((m) => m.id === assistantMessageId)
          return Boolean(row?.content?.trim())
        }
        return true
      } catch {
        return false
      }
    },
    [queryClient]
  )

  const scheduleAssistantSync = useCallback(
    (assistantMessageId: string) => {
      clearSyncTimeouts()
      const delaysMs = [2000, 4000, 7000, 11000, 16000, 22000, 30000]
      for (const delay of delaysMs) {
        const id = window.setTimeout(() => {
          void refreshConversationFromServer(assistantMessageId).then((done) => {
            if (done) clearSyncTimeouts()
          })
        }, delay)
        syncTimeoutsRef.current.push(id)
      }
    },
    [clearSyncTimeouts, refreshConversationFromServer]
  )

  useEffect(() => () => clearSyncTimeouts(), [clearSyncTimeouts])

  const {
    data: conversation,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['ai', 'conversation'],
    queryFn: getAiConversation,
    enabled: active && !!userId,
  })

  const { data: usage } = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: getAiUsage,
    enabled: active && !!userId,
  })

  useEffect(() => {
    if (!userId || !active) return
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
  }, [userId, active])

  useEffect(() => {
    if (conversation?.conversationId) {
      conversationIdRef.current = conversation.conversationId
    }
    if (conversation?.messages) {
      setMessages((prev) => mergeApiWithLocal(prev, conversation.messages))
    }
  }, [conversation])

  useEffect(() => {
    if (loadError) {
      setError(getApiErrorMessage(loadError))
    }
  }, [loadError])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const upsertAssistantMessage = useCallback(
    (messageId: string, updater: (prev: AiUiMessage | undefined) => AiUiMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = updater(prev[idx])
          return next
        }
        return [...prev, updater(undefined)]
      })
    },
    []
  )

  useEffect(() => {
    if (!userId || !active) return

    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type !== 'ai.chat.delta') return
      const raw = event.payload as Record<string, unknown>
      const payload = {
        type: raw.type as string,
        conversationId: (raw.conversationId ?? raw.conversation_id) as string,
        messageId: (raw.messageId ?? raw.message_id) as string,
        text: (raw.text as string | undefined) ?? undefined,
        content: (raw.content as string | undefined) ?? undefined,
      }
      const convId = conversationIdRef.current
      if (convId && payload.conversationId && payload.conversationId !== convId) return

      const { type, messageId, text, content } = payload

      if (type === 'message') {
        const full = content ?? text ?? ''
        upsertAssistantMessage(messageId, () => ({
          id: messageId,
          role: 'assistant',
          content: full,
          streaming: false,
          time: formatTime(new Date().toISOString()),
        }))
        clearSyncTimeouts()
        void refreshConversationFromServer(messageId)
        void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] })
        return
      }

      if (type === 'delta' && text) {
        upsertAssistantMessage(messageId, (prev) => ({
          id: messageId,
          role: 'assistant',
          content: (prev?.content ?? '') + text,
          streaming: true,
          time: prev?.time ?? formatTime(new Date().toISOString()),
        }))
        return
      }

      if (type === 'done') {
        clearSyncTimeouts()
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, streaming: false } : m))
        )
        void refreshConversationFromServer(messageId)
        void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] })
        return
      }

      if (type === 'error') {
        const errText = text ?? 'Sorry, I could not complete that response. Please try again.'
        clearSyncTimeouts()
        upsertAssistantMessage(messageId, (prev) => ({
          id: messageId,
          role: 'assistant',
          content: errText,
          streaming: false,
          time: prev?.time ?? formatTime(new Date().toISOString()),
        }))
        void refreshConversationFromServer(messageId)
        void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] })
        toast(errText)
      }
    })

    return unsubscribe
  }, [
    userId,
    active,
    queryClient,
    upsertAssistantMessage,
    clearSyncTimeouts,
    refreshConversationFromServer,
  ])

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !userId || sending) return

    const idempotencyKey = crypto.randomUUID()
    const optimisticUserId = `temp-user-${idempotencyKey}`
    const now = formatTime(new Date().toISOString())

    setSending(true)
    setInputValue('')
    setError(null)

    setMessages((prev) => [
      ...prev,
      { id: optimisticUserId, role: 'user', content: trimmed, time: now },
    ])

    try {
      const result = await sendAiMessage({ message: trimmed, idempotencyKey })
      conversationIdRef.current = result.conversationId

      const assistantMessageId = result.assistantMessageId
      setMessages((prev) => {
        const withUser = prev.map((m) =>
          m.id === optimisticUserId ? { ...m, id: result.userMessageId } : m
        )
        const hasAssistant = withUser.some((m) => m.id === assistantMessageId)
        if (hasAssistant) return withUser
        return [
          ...withUser,
          {
            id: assistantMessageId,
            role: 'assistant' as const,
            content: '',
            streaming: true,
            time: now,
          },
        ]
      })

      scheduleAssistantSync(assistantMessageId)
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserId))
      const msg = getApiErrorMessage(e)
      setError(msg)
      toast(msg)
      setInputValue(trimmed)
    } finally {
      setSending(false)
      requestAnimationFrame(() => messageInputRef.current?.focus())
    }
  }, [inputValue, userId, sending, scheduleAssistantSync])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const tokensUsed = usage?.tokensUsed ?? 0
  const dailyCap = usage?.dailyCap ?? 0

  return (
    <>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        <div className="px-3 py-4 space-y-3">
          {error && <p className="text-xs text-red-400/90 px-2">{error}</p>}
          {isLoading ? (
            <div className="flex items-center gap-2 py-2 text-text-muted px-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Loading conversation…</span>
            </div>
          ) : messages.length === 0 ? (
            <AiEmptyState />
          ) : (
            messages.map((msg) => <AiMessageBubble key={msg.id} msg={msg} />)
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-background/80">
        <AiChatFooter
          tokensUsed={tokensUsed}
          dailyCap={dailyCap}
          inputValue={inputValue}
          setInputValue={setInputValue}
          handleKeyDown={handleKeyDown}
          handleSend={handleSend}
          sending={sending}
          messageInputRef={messageInputRef}
        />
      </div>
    </>
  )
}

function AiEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center text-text-muted px-4">
      <Sparkles className="h-9 w-9 mb-3 text-accent/70" />
      <p className="text-sm font-medium text-text">Ask me anything about this platform</p>
      <p className="text-xs mt-1.5 leading-relaxed">
        I can help with your account, orders, positions, deposits, and how to use the terminal.
      </p>
    </div>
  )
}

function AiChatFooter({
  tokensUsed,
  dailyCap,
  inputValue,
  setInputValue,
  handleKeyDown,
  handleSend,
  sending,
  messageInputRef,
}: {
  tokensUsed: number
  dailyCap: number
  inputValue: string
  setInputValue: (v: string) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
  handleSend: () => void
  sending: boolean
  messageInputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <>
      <div className="px-3 py-1.5 text-[10px] text-text-muted border-b border-white/5">
        Tokens today: {tokensUsed.toLocaleString()} / {dailyCap.toLocaleString()}
      </div>
      <div className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Input
            ref={messageInputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your account, orders, positions..."
            className="flex-1 min-w-0 h-9 text-sm bg-white/5 border-white/10 focus-visible:ring-accent/50"
            aria-label="AI chat message"
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
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </>
  )
}

function AiMessageBubble({ msg }: { msg: AiUiMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div
      className={cn(
        'flex flex-col max-w-[92%]',
        isUser ? 'items-end ml-auto' : 'items-start'
      )}
    >
      <div
        className={cn(
          'rounded-lg px-3 py-2 text-xs',
          isUser
            ? 'bg-accent/20 text-text border border-accent/30'
            : 'bg-surface-2 text-text/90 border border-border'
        )}
      >
        <p className="text-sm leading-snug whitespace-pre-wrap">
          {msg.streaming && !msg.content.trim() ? (
            <span className="text-text-muted italic">Thinking…</span>
          ) : (
            msg.content
          )}
          {msg.streaming && msg.content.trim() && (
            <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 animate-pulse align-middle" />
          )}
        </p>
        <div className="font-medium text-[10px] uppercase tracking-wider text-text-muted mt-1.5 text-right">
          {isUser ? 'You' : 'AI'} · {msg.time}
        </div>
      </div>
    </div>
  )
}

/** Clear conversation — used from ChatPanel header */
export function useAiChatClear(_active?: boolean) {
  const queryClient = useQueryClient()
  const [clearing, setClearing] = useState(false)

  const clear = useCallback(async () => {
    if (clearing) return
    setClearing(true)
    try {
      await clearAiConversation()
      void queryClient.invalidateQueries({ queryKey: ['ai', 'conversation'] })
      void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] })
    } catch (e) {
      toast(getApiErrorMessage(e))
    } finally {
      setClearing(false)
    }
  }, [clearing, queryClient])

  return { clear, clearing }
}
