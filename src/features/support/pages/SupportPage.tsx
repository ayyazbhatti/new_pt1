import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Input, Button, ModalShell } from '@/shared/ui'
import { MessageCircle, Send, User, UserPlus, Search, Loader2 } from 'lucide-react'
import { cn } from '@/shared/utils'
import {
  getAdminConversations,
  getAdminConversationMessages,
  sendAdminChatMessage,
} from '../api/supportChat.api'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'
import { listUsers, type UserResponse } from '@/shared/api/users.api'

type ChatMessage = { id: string; sender: 'support' | 'user'; name: string; text: string; time: string }

type ConversationSummary = {
  userId: string
  userName: string
  userEmail: string
  lastMessage: string
  lastTime: string
}

type SelectedUserInfo = { userId: string; userName: string; userEmail: string }

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

function dtoToMessage(dto: {
  id: string
  senderType: string
  body: string
  createdAt: string
}, userName?: string): ChatMessage {
  const sender = dto.senderType === 'user' ? 'user' : 'support'
  return {
    id: dto.id,
    sender,
    name: sender === 'user' ? (userName ?? 'User') : 'Support',
    text: dto.body,
    time: formatTime(dto.createdAt),
  }
}

export function SupportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedUserId = searchParams.get('userId')
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [messagesByUser, setMessagesByUser] = useState<Record<string, ChatMessage[]>>({})
  const [selectedUserInfo, setSelectedUserInfo] = useState<SelectedUserInfo | null>(null)
  const [selectUserModalOpen, setSelectUserModalOpen] = useState(false)
  const [allUsers, setAllUsers] = useState<UserResponse[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const knownIdsByUser = useRef<Record<string, Set<string>>>({})
  const conversationsRef = useRef<ConversationSummary[]>([])
  const selectedUserDisplayRef = useRef<{ userId: string; userName: string; userEmail: string } | null>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  conversationsRef.current = conversations

  // Ensure WebSocket is connected on Support page (so we receive new user messages in real time)
  useEffect(() => {
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
  }, [])

  // Load conversations on mount
  useEffect(() => {
    setError(null)
    setLoadingConversations(true)
    getAdminConversations()
      .then(setConversations)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load conversations'))
      .finally(() => setLoadingConversations(false))
  }, [])

  // Keep display ref in sync for message-load callback (conversation list or selected "new" user)
  useEffect(() => {
    if (!selectedUserId) {
      selectedUserDisplayRef.current = null
      return
    }
    const fromConv = conversations.find((c) => c.userId === selectedUserId)
    if (fromConv) {
      selectedUserDisplayRef.current = { userId: fromConv.userId, userName: fromConv.userName, userEmail: fromConv.userEmail }
      return
    }
    if (selectedUserInfo?.userId === selectedUserId) {
      selectedUserDisplayRef.current = { userId: selectedUserInfo.userId, userName: selectedUserInfo.userName, userEmail: selectedUserInfo.userEmail }
      return
    }
    selectedUserDisplayRef.current = { userId: selectedUserId, userName: 'User', userEmail: selectedUserId }
  }, [selectedUserId, selectedUserInfo, conversations])

  // Load messages when selecting a user
  useEffect(() => {
    if (!selectedUserId) return
    if (messagesByUser[selectedUserId]) return // already loaded
    setLoadingMessages(true)
    getAdminConversationMessages(selectedUserId)
      .then((list) => {
        const display = selectedUserDisplayRef.current
        const userName = display?.userId === selectedUserId ? display.userName : undefined
        const msgs = list.map((dto) => dtoToMessage(dto, userName))
        setMessagesByUser((prev) => ({ ...prev, [selectedUserId]: msgs }))
        if (!knownIdsByUser.current[selectedUserId]) knownIdsByUser.current[selectedUserId] = new Set()
        msgs.forEach((m) => knownIdsByUser.current[selectedUserId].add(m.id))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load messages'))
      .finally(() => setLoadingMessages(false))
  }, [selectedUserId ?? '', messagesByUser])

  // Real-time: new user messages (chat.support) and support replies; use ref for conversations to avoid re-subscribing on every update
  useEffect(() => {
    console.log('[SupportPage] Registered WS handler for real-time chat')
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      const e = event as Record<string, unknown>
      const payload = (e.payload ?? e) as Record<string, unknown>
      if (!payload || typeof payload.body !== 'string') return
      const uid = (payload.userId ?? payload.user_id) as string | undefined
      if (!uid) return
      const id = (payload.id as string) || ''
      if (!id) return
      const known = knownIdsByUser.current[uid] ?? new Set()
      if (known.has(id)) return
      known.add(id)
      knownIdsByUser.current[uid] = known
      const conv = conversationsRef.current.find((c) => c.userId === uid)
      const userName = conv?.userName
      const dto = {
        id,
        senderType: (payload.senderType ?? payload.sender_type ?? 'user') as string,
        body: (payload.body as string) ?? '',
        createdAt: (payload.createdAt ?? payload.created_at ?? new Date().toISOString()) as string,
      }
      const msg = dtoToMessage(dto, userName)
      setMessagesByUser((prev) => {
        const list = prev[uid] ?? []
        // Defensive dedupe: avoid duplicate messages when the same WS event is delivered twice (e.g. multiple handlers or re-delivery)
        if (list.some((m) => m.id === id)) return prev
        return { ...prev, [uid]: [...list, msg] }
      })
      if ((payload.senderType ?? payload.sender_type) === 'user') {
        setConversations((prev) => {
          const existing = prev.find((c) => c.userId === uid)
          if (existing) {
            return prev.map((c) =>
              c.userId === uid
                ? { ...c, lastMessage: (payload.body as string) ?? '', lastTime: formatTime((payload.createdAt ?? payload.created_at) as string) }
                : c
            )
          }
          getAdminConversations().then(setConversations)
          return prev
        })
      }
    })
    return unsubscribe
  }, [])

  const selected =
    selectedUserId && selectedUserInfo?.userId === selectedUserId
      ? { userId: selectedUserInfo.userId, userName: selectedUserInfo.userName, userEmail: selectedUserInfo.userEmail }
      : selectedUserId
        ? conversations.find((c) => c.userId === selectedUserId) ?? null
        : null
  const selectedMessages = selectedUserId ? messagesByUser[selectedUserId] ?? [] : []

  // Scroll to bottom when messages load or when new messages arrive so latest is visible
  useEffect(() => {
    if (!selectedUserId || loadingMessages) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedUserId, loadingMessages, selectedMessages.length])

  const setSelectedUserId = useCallback((userId: string | null, userInfo?: SelectedUserInfo | null) => {
    if (userInfo !== undefined) setSelectedUserInfo(userInfo ?? null)
    if (userId) setSearchParams({ userId }, { replace: true })
    else setSearchParams({}, { replace: true })
  }, [setSearchParams])

  // Load users when opening "Select user" modal
  useEffect(() => {
    if (!selectUserModalOpen) return
    setUsersLoading(true)
    listUsers({ limit: 500 })
      .then((res) => setAllUsers(res.items))
      .catch(() => setAllUsers([]))
      .finally(() => setUsersLoading(false))
  }, [selectUserModalOpen])

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return allUsers
    const q = userSearch.trim().toLowerCase()
    return allUsers.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.first_name?.toLowerCase().includes(q) ||
        u.last_name?.toLowerCase().includes(q)
    )
  }, [allUsers, userSearch])

  const handleSelectUser = useCallback((u: UserResponse) => {
    const inList = conversations.some((c) => c.userId === u.id)
    if (inList) {
      setSelectedUserInfo(null)
    } else {
      const userName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'User'
      setSelectedUserInfo({ userId: u.id, userName, userEmail: u.email ?? '' })
    }
    setSearchParams({ userId: u.id }, { replace: true })
    setSelectUserModalOpen(false)
    setUserSearch('')
  }, [setSearchParams, conversations])

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !selectedUserId || sending) return
    setSending(true)
    setInputValue('')
    try {
      const created = await sendAdminChatMessage(selectedUserId, trimmed)
      const msg = dtoToMessage(created, selected?.userName)
      if (!knownIdsByUser.current[selectedUserId]) knownIdsByUser.current[selectedUserId] = new Set()
      knownIdsByUser.current[selectedUserId].add(created.id)
      setMessagesByUser((prev) => {
        const list = prev[selectedUserId] ?? []
        if (list.some((m) => m.id === created.id)) return prev
        return { ...prev, [selectedUserId]: [...list, msg] }
      })
      setConversations((prev) =>
        prev.map((c) =>
          c.userId === selectedUserId
            ? { ...c, lastMessage: trimmed, lastTime: formatTime(created.createdAt) }
            : c
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
      setInputValue(trimmed)
    } finally {
      setSending(false)
      requestAnimationFrame(() => messageInputRef.current?.focus())
    }
  }, [inputValue, selectedUserId, selected?.userName, sending])

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
    <ContentShell className="flex flex-col h-[calc(100vh-8rem)] min-h-[480px]">
      <PageHeader
        title="Support"
        description="Chat with users and respond to support inquiries."
      />
      <div className="flex-1 min-h-0 flex gap-4 border border-border rounded-lg bg-surface overflow-hidden">
        {/* Conversation list */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border bg-surface-2/30">
          <div className="shrink-0 px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text">Conversations</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {loadingConversations ? 'Loading...' : `${conversations.length} open`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full mt-2 gap-2"
              onClick={() => setSelectUserModalOpen(true)}
            >
              <UserPlus className="h-3.5 w-3.5" />
              New chat
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {error && <p className="text-xs text-red-400/90 px-4 py-2">{error}</p>}
            {conversations.map((conv) => (
              <button
                key={conv.userId}
                type="button"
                onClick={() => setSelectedUserId(conv.userId, null)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-border/50 hover:bg-white/5 transition-colors',
                  selectedUserId === conv.userId && 'bg-accent/10 border-l-2 border-l-accent'
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="shrink-0 h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-text truncate">{conv.userName}</div>
                    <div className="text-xs text-text-muted truncate">{conv.userEmail}</div>
                    <div className="text-xs text-text-muted/80 mt-0.5 truncate">{conv.lastMessage}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">{conv.lastTime}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedUserId ? (
            <>
              <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-text">{selected?.userName ?? 'User'}</h2>
                <span className="text-xs text-text-muted">({selected?.userEmail ?? selectedUserId})</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
                {loadingMessages ? (
                  <p className="text-xs text-text-muted">Loading messages...</p>
                ) : (
                  <>
                    {selectedMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          'flex flex-col max-w-[85%]',
                          msg.sender === 'user' ? 'items-start' : 'items-end ml-auto'
                        )}
                      >
                        <div
                          className={cn(
                            'rounded-lg px-3 py-2 text-xs',
                            msg.sender === 'user'
                              ? 'bg-white/5 text-text border border-border'
                              : 'bg-accent/15 text-text border border-accent/30'
                          )}
                        >
                          <p className="text-sm leading-snug whitespace-pre-wrap">{msg.text}</p>
                          <div className="font-medium text-[10px] uppercase tracking-wider text-text-muted mt-1.5 text-right">
                            {(msg.sender === 'user' ? selected?.userName : msg.name) ?? msg.name} · {msg.time}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} className="shrink-0 h-px" aria-hidden />
                  </>
                )}
              </div>
              <div className="shrink-0 p-4 border-t border-border bg-surface-2/30">
                <div className="flex items-center gap-2">
                  <Input
                    ref={messageInputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your reply..."
                    className="flex-1 min-w-0 h-10 text-sm"
                    aria-label="Reply to user"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() || sending}
                    className="shrink-0 p-2.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    title="Send message"
                    aria-label="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <MessageCircle className="h-14 w-14 text-text-muted/30 mb-4" />
              <p className="text-sm font-medium text-text/80">Select a conversation</p>
              <p className="text-xs text-text-muted mt-1 max-w-[240px]">
                Choose a user from the list to view the chat and reply.
              </p>
            </div>
          )}
        </div>
      </div>

      <ModalShell
        open={selectUserModalOpen}
        onOpenChange={setSelectUserModalOpen}
        onClose={() => { setSelectUserModalOpen(false); setUserSearch('') }}
        title="Select user"
        description="Choose a user to start a new chat."
        size="md"
      >
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              type="text"
              placeholder="Search by name or email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="max-h-[60vh] overflow-auto border border-border rounded-lg divide-y divide-border">
            {usersLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading users...</span>
              </div>
            ) : filteredUsers.length === 0 ? (
              <p className="text-sm text-text-muted py-6 text-center">No users found</p>
            ) : (
              filteredUsers.map((u) => {
                const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || '—'
                const isInConversations = conversations.some((c) => c.userId === u.id)
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleSelectUser(u)}
                    className={cn(
                      'w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex items-center gap-3',
                      selectedUserId === u.id && 'bg-accent/10'
                    )}
                  >
                    <div className="shrink-0 h-9 w-9 rounded-lg bg-surface-2 flex items-center justify-center text-accent">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-text truncate">{name}</div>
                      <div className="text-xs text-text-muted truncate">{u.email}</div>
                      {isInConversations && (
                        <span className="text-[10px] text-text-muted mt-0.5">Has conversation</span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </ModalShell>
    </ContentShell>
  )
}
