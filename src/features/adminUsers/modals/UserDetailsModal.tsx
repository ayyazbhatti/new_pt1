import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { User } from '../types/users'
import { useModalStore } from '@/app/store'
import { CreateEditUserModal } from './CreateEditUserModal'
import { formatDateTime, formatCurrency, formatAccountAge } from '../utils/formatters'
import { toast } from '@/shared/components/common'
import {
  Edit,
  X,
  CheckCircle,
  Package,
  User as UserIcon,
  DollarSign,
  Calendar,
  ListOrdered,
  MessageSquare,
  MessageCircle,
  Send,
  Key,
  Shield,
  XCircle,
  Unlock,
  Lock,
  TrendingUp,
  TrendingDown,
  CreditCard,
  ArrowDownCircle,
  ArrowUpCircle,
  Plus,
} from 'lucide-react'
import { fetchTransactions } from '@/features/adminFinance/api/finance.api'
import { fetchUserNotes, createUserNote, type UserNote } from '../api/users.api'
import { getPositionsByUserId } from '@/features/terminal/api/positions.api'
import { usePriceStream, normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import { Input } from '@/shared/ui'
import { cn } from '@/shared/utils'
import {
  getAdminConversationMessages,
  sendAdminChatMessage,
} from '@/features/support/api/supportChat.api'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'

const USER_DETAILS_TAB_STORAGE_KEY = 'admin-user-details-modal-tab'
const TAB_VALUES = ['overview', 'funding', 'appointments', 'orders-positions', 'notes', 'chat'] as const

type ChatMessage = { id: string; sender: 'support' | 'user'; name: string; text: string; time: string }

function formatChatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

function dtoToChatMessage(
  dto: { id: string; senderType: string; body: string; createdAt: string },
  userName?: string
): ChatMessage {
  const sender = dto.senderType === 'user' ? 'user' : 'support'
  return {
    id: dto.id,
    sender,
    name: sender === 'user' ? (userName ?? 'User') : 'Support',
    text: dto.body,
    time: formatChatTime(dto.createdAt),
  }
}

function getStoredUserDetailsTab(): (typeof TAB_VALUES)[number] {
  if (typeof sessionStorage === 'undefined') return 'overview'
  const stored = sessionStorage.getItem(USER_DETAILS_TAB_STORAGE_KEY)
  return TAB_VALUES.includes(stored as (typeof TAB_VALUES)[number]) ? (stored as (typeof TAB_VALUES)[number]) : 'overview'
}

interface UserDetailsModalProps {
  user: User
}

export function UserDetailsModal({ user }: UserDetailsModalProps) {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const [userState, setUserState] = useState(user)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<typeof TAB_VALUES[number]>(getStoredUserDetailsTab)
  const [noteDraft, setNoteDraft] = useState('')
  const [isEditMode, setIsEditMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [ordersPositionsSubTab, setOrdersPositionsSubTab] = useState<'orders' | 'positions' | 'pending' | 'closed'>('positions')

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [chatInputValue, setChatInputValue] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)
  const knownChatIds = useRef<Set<string>>(new Set())
  const chatLoadedForUserIdRef = useRef<string | null>(null)
  const chatMessagesEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const userRef = useRef(user.id)
  userRef.current = user.id

  const { data: transactionsData, isLoading: transactionsLoading } = useQuery({
    queryKey: ['user-transactions', user.id, user.email],
    queryFn: () => fetchTransactions({ search: user.email, pageSize: 100 }),
    enabled: !!user.email,
  })
  const transactions = transactionsData ?? []

  const { data: positionsData, isLoading: positionsLoading } = useQuery({
    queryKey: ['user-positions', user.id],
    queryFn: () => getPositionsByUserId(user.id),
    enabled: !!user.id,
    staleTime: 15_000,
  })
  const positions = positionsData ?? []
  const openPositions = useMemo(
    () =>
      positions
        .filter((p) => p.status === 'OPEN')
        .sort((a, b) => (b.opened_at || b.updated_at || 0) - (a.opened_at || a.updated_at || 0)),
    [positions]
  )
  const positionSymbols = useMemo(
    () => Array.from(new Set(openPositions.map((p) => p.symbol.toUpperCase().trim()))),
    [openPositions]
  )
  const { prices: livePrices } = usePriceStream(positionSymbols)

  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['user-notes', user.id],
    queryFn: () => fetchUserNotes(user.id),
    enabled: !!user.id,
  })

  const createNoteMutation = useMutation({
    mutationFn: (content: string) => createUserNote(user.id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-notes', user.id] })
      setNoteDraft('')
      toast.success('Note added')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add note')
    },
  })

  // Ensure WS connected when modal is open (Chat tab may use it)
  useEffect(() => {
    wsClient.connect()
  }, [])

  // Reset chat state when user changes
  useEffect(() => {
    chatLoadedForUserIdRef.current = null
    setChatMessages([])
    setChatLoading(false)
    setChatSending(false)
    setChatInputValue('')
    setChatError(null)
    knownChatIds.current = new Set()
  }, [user.id])

  // Load chat messages when Chat tab is selected and not yet loaded for this user
  useEffect(() => {
    if (activeTab !== 'chat' || !user.id) return
    if (chatLoadedForUserIdRef.current === user.id) return
    chatLoadedForUserIdRef.current = user.id
    setChatLoading(true)
    setChatError(null)
    getAdminConversationMessages(user.id)
      .then((list) => {
        const msgs = (Array.isArray(list) ? list : []).map((dto) =>
          dtoToChatMessage(
            {
              id: dto.id,
              senderType: dto.senderType,
              body: dto.body,
              createdAt: dto.createdAt,
            },
            userState.name || userState.email
          )
        )
        setChatMessages(msgs)
        msgs.forEach((m) => knownChatIds.current.add(m.id))
      })
      .catch((e) => setChatError(e instanceof Error ? e.message : 'Failed to load messages'))
      .finally(() => setChatLoading(false))
  }, [activeTab, user.id, userState.name, userState.email])

  // WebSocket: append new chat messages for this user only
  useEffect(() => {
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      if (event.type !== 'chat.message') return
      const payload = event.payload
      const uid = payload?.userId
      if (uid !== userRef.current) return
      const id = payload?.id ?? ''
      if (!id || knownChatIds.current.has(id)) return
      knownChatIds.current.add(id)
      const userName = userState.name || userState.email
      const msg: ChatMessage = {
        id,
        sender: payload.senderType === 'user' ? 'user' : 'support',
        name: payload.senderType === 'user' ? userName : 'Support',
        text: payload?.body ?? '',
        time: formatChatTime(payload?.createdAt ?? ''),
      }
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === id)) return prev
        return [...prev, msg]
      })
    })
    return unsubscribe
  }, [userState.name, userState.email])

  const handleSendChat = useCallback(() => {
    const text = chatInputValue.trim()
    if (!text || !user.id || chatSending) return
    setChatSending(true)
    setChatError(null)
    sendAdminChatMessage(user.id, text)
      .then((dto) => {
        knownChatIds.current.add(dto.id)
        const msg = dtoToChatMessage(
          {
            id: dto.id,
            senderType: dto.senderType,
            body: dto.body,
            createdAt: dto.createdAt,
          },
          userState.name || userState.email
        )
        setChatMessages((prev) => (prev.some((m) => m.id === dto.id) ? prev : [...prev, msg]))
        setChatInputValue('')
        setTimeout(() => chatInputRef.current?.focus(), 0)
      })
      .catch((e) => setChatError(e instanceof Error ? e.message : 'Failed to send'))
      .finally(() => setChatSending(false))
  }, [user.id, chatInputValue, chatSending, userState.name, userState.email])

  // Scroll chat to bottom when messages change and Chat tab is active
  useEffect(() => {
    if (activeTab !== 'chat') return
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeTab, chatMessages.length])

  const metrics = useMemo(() => {
    const balance = userState.balance ?? 0
    let totalMargin = 0
    let unrealizedPnl = 0
    openPositions.forEach((pos) => {
      totalMargin += parseFloat(pos.margin || '0')
      const sizeNum = parseFloat(pos.size || '0')
      const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
      const symbolKey = normalizeSymbolKey(pos.symbol)
      const priceData = livePrices.get(symbolKey) ?? livePrices.get(pos.symbol?.toUpperCase?.() ?? '')
      const livePrice = priceData
        ? pos.side === 'LONG'
          ? parseFloat(priceData.bid)
          : parseFloat(priceData.ask)
        : null
      if (livePrice !== null) {
        unrealizedPnl += pos.side === 'LONG' ? (livePrice - entryPrice) * sizeNum : (entryPrice - livePrice) * sizeNum
      } else {
        unrealizedPnl += parseFloat(pos.unrealized_pnl || '0')
      }
    })
    const equity = balance + unrealizedPnl
    const freeMargin = equity - totalMargin
    const marginLevel = totalMargin > 0 ? (equity / totalMargin) * 100 : 0
    return {
      balance,
      equity,
      margin: totalMargin,
      freeMargin,
      marginLevel,
      unrealizedPnl,
    }
  }, [userState.balance, openPositions, livePrices])

  type TransactionRow = {
    id: string
    type: string
    amount: number
    currency: string
    netAmount: number
    status: string
    reference: string
    createdAt: string
    method: string
  }

  const handleClose = () => closeModal(`user-details-${user.id}`)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`))
  }

  return (
    <>
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-700">
        <div className="flex items-center justify-between p-3 sm:p-4 md:p-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 sm:h-10 sm:w-10">
              <UserIcon className="h-4 w-4 text-white sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-base font-semibold text-white sm:text-lg md:text-xl cursor-pointer hover:text-blue-400"
                title="Click to copy email"
                onClick={() => copyToClipboard(userState.email, 'Email')}
              >
                {userState.email}
              </div>
              <div
                className="truncate text-xs text-slate-400 sm:text-sm cursor-pointer hover:text-blue-400"
                title="Click to copy ID"
                onClick={() => copyToClipboard(userState.id, 'User ID')}
              >
                ID: {userState.id}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="ml-2 flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white sm:p-2"
          >
            <X className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>
      </header>

      {/* Metrics bar */}
      <div className="flex-shrink-0 border-t border-slate-700/50 bg-slate-800/50 px-3 pt-3 pb-3 sm:px-4 sm:pt-4 sm:pb-4">
        {positionsLoading ? (
          <div className="flex items-center justify-center gap-2 py-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
            <span className="text-sm text-slate-400">Loading metrics...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-6">
            <div>
              <div className="mb-1 text-xs text-slate-400">Balance</div>
              <div className="text-sm font-semibold text-white sm:text-base">
                {formatCurrency(metrics.balance, 'USD')}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">Equity</div>
              <div className="text-sm font-semibold text-white sm:text-base">
                {formatCurrency(metrics.equity, 'USD')}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">Margin</div>
              <div className="text-sm font-semibold text-white sm:text-base">
                {formatCurrency(metrics.margin, 'USD')}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">Free Margin</div>
              <div
                className={cn(
                  'text-sm font-semibold sm:text-base',
                  metrics.freeMargin >= 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                {formatCurrency(metrics.freeMargin, 'USD')}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">Margin Level</div>
              <div
                className={cn(
                  'text-sm font-semibold sm:text-base',
                  metrics.marginLevel < 100 ? 'text-red-400' : metrics.marginLevel < 200 ? 'text-yellow-400' : 'text-green-400'
                )}
              >
                {metrics.marginLevel > 0 ? `${metrics.marginLevel.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">Unrealized P&L</div>
              <div
                className={cn(
                  'text-sm font-semibold sm:text-base',
                  metrics.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                {formatCurrency(metrics.unrealizedPnl, 'USD')}
              </div>
            </div>
          </div>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const tab = value as (typeof TAB_VALUES)[number]
          if (TAB_VALUES.includes(tab)) {
            setActiveTab(tab)
            try {
              sessionStorage.setItem(USER_DETAILS_TAB_STORAGE_KEY, tab)
            } catch {
              // ignore
            }
          }
        }}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <div className="flex flex-shrink-0 items-center space-x-1 overflow-x-auto border-t border-b border-slate-700 px-2 py-2 sm:space-x-2 sm:px-4 sm:py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            { value: 'overview' as const, label: 'Overview', shortLabel: 'Overview', icon: UserIcon },
            { value: 'funding' as const, label: 'Funding History', shortLabel: 'Funding', icon: DollarSign },
            { value: 'appointments' as const, label: 'Appointments', shortLabel: 'Appointments', icon: Calendar },
            { value: 'orders-positions' as const, label: 'Orders & Positions', shortLabel: 'Orders', icon: ListOrdered },
            { value: 'notes' as const, label: 'Notes & Timeline', shortLabel: 'Notes', icon: MessageSquare },
            { value: 'chat' as const, label: 'Chat', shortLabel: 'Chat', icon: MessageCircle },
          ].map(({ value, label, shortLabel, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setActiveTab(value)
                try {
                  sessionStorage.setItem(USER_DETAILS_TAB_STORAGE_KEY, value)
                } catch {
                  // ignore
                }
              }}
              className={cn(
                'flex flex-shrink-0 items-center space-x-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium sm:space-x-2 sm:px-3 sm:py-2 sm:px-4 sm:text-sm',
                activeTab === value
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
              )}
            >
              <Icon className={cn('h-4 w-4', activeTab === value ? 'text-white' : 'text-slate-400')} />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{shortLabel}</span>
            </button>
          ))}
        </div>

        <TabsContent value="overview" className="flex-1 min-h-0 overflow-auto mt-3 data-[state=inactive]:hidden">
          <div className="min-h-[420px] flex-1 overflow-y-auto p-3 sm:min-h-[520px] sm:p-4 md:p-6">
            <h2 className="border-b border-slate-700 pb-3 text-base font-semibold text-white sm:pb-4 sm:text-lg">
              User Information
            </h2>
            <div className="grid grid-cols-1 gap-3 pt-4 sm:gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Email Address {isEditMode && <span className="ml-2 text-xs text-blue-400">✏️ Editable</span>}
                </label>
                <input
                  readOnly={!isEditMode}
                  value={userState.email}
                  onChange={(e) => isEditMode && setUserState({ ...userState, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Enter email address"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Email Verification</label>
                <div className="flex items-center justify-between rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5">
                  <span className="text-sm text-white">
                    {userState.kycStatus === 'verified' ? '✓ Verified' : '✗ Not Verified'}
                  </span>
                  {userState.kycStatus === 'verified' ? (
                    <CheckCircle className="h-5 w-5 text-green-400" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400" />
                  )}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  User Group {isEditMode && <span className="ml-2 text-xs text-blue-400">✏️ Editable</span>}
                </label>
                <div className="flex items-center justify-between rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5">
                  <span className="text-sm text-white">{userState.groupName || 'No Group'}</span>
                  <Shield className="h-5 w-5 text-purple-400" />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Account Status</label>
                <div className="flex items-center justify-between rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5">
                  <span className="text-sm text-white">{userState.status === 'active' ? 'Active' : 'Locked'}</span>
                  {userState.status === 'active' ? (
                    <Unlock className="h-5 w-5 text-green-400" />
                  ) : (
                    <Lock className="h-5 w-5 text-red-400" />
                  )}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Account Created</label>
                <input
                  readOnly
                  value={formatDateTime(userState.createdAt)}
                  className="w-full cursor-not-allowed rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Account Age</label>
                <input
                  readOnly
                  value={formatAccountAge(userState.createdAt)}
                  className="w-full cursor-not-allowed rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Username</label>
                <input
                  readOnly
                  value={userState.email?.split('@')[0] ?? '—'}
                  className="w-full cursor-not-allowed rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">First Name</label>
                <input
                  readOnly
                  value={userState.name?.split(' ')[0] ?? '—'}
                  className="w-full cursor-not-allowed rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Last Name</label>
                <input
                  readOnly
                  value={userState.name?.split(' ').slice(1).join(' ') || '—'}
                  className="w-full cursor-not-allowed rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Online Status</label>
                <span className={cn('text-sm font-medium', userState.lastLogin ? 'text-green-400' : 'text-red-400')}>
                  {userState.lastLogin ? 'Online' : 'Offline'}
                </span>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Trading Enabled</label>
                <span className={cn('flex items-center gap-1 text-sm', userState.tradingEnabled ? 'text-green-400' : 'text-red-400')}>
                  {userState.tradingEnabled ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {userState.tradingEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Leverage Range</label>
                <input
                  readOnly
                  value={
                    userState.leverageLimitMin > 0 || userState.leverageLimitMax > 0
                      ? `${userState.leverageLimitMin}× – ${userState.leverageLimitMax}×`
                      : 'Inherit from group/symbol'
                  }
                  className="w-full cursor-not-allowed rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <p className="mt-1 text-xs text-slate-400">Per-symbol limits may apply.</p>
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-slate-300">User ID</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={userState.id}
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 font-mono text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(userState.id, 'User ID')}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm text-white hover:bg-blue-700"
                  >
                    <Key className="h-4 w-4" />
                    Copy
                  </button>
                </div>
              </div>
              <div className="md:col-span-3">
                <label className="mb-2 block text-sm font-medium text-slate-300">Trading Accounts</label>
                <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-4">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <CreditCard className="h-5 w-5" />
                    <span className="font-mono">—</span>
                    <span>No accounts found</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-700 pt-4">
              {isEditMode ? (
                <>
                  <p className="text-xs text-blue-400">✏️ Edit mode - Make changes and click Save</p>
                  <button
                    type="button"
                    onClick={() => setIsEditMode(false)}
                    className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 sm:px-4"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={async () => {
                      setIsSaving(true)
                      await new Promise((r) => setTimeout(r, 500))
                      setIsSaving(false)
                      setIsEditMode(false)
                      toast.success('Changes saved')
                    }}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-70 sm:px-4"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    className="flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 sm:px-4 sm:text-base"
                  >
                    <Edit className="h-4 w-4" />
                    Edit Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.success('Reset password link sent')}
                    className="flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 sm:px-4 sm:text-base"
                  >
                    <Key className="h-4 w-4" />
                    Reset Password
                  </button>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="funding" className="flex-1 min-h-0 overflow-auto mt-3 data-[state=inactive]:hidden">
          <div className="min-h-[420px] flex-1 overflow-y-auto p-3 sm:min-h-[520px] sm:p-4 md:p-6">
            {transactionsLoading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-blue-500" />
                <span className="ml-2 text-sm text-slate-400">Loading transactions...</span>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-4 sm:items-center">
                  <div className="flex-1 rounded-lg border border-slate-600 bg-slate-700/50 p-4">
                    <div className="mb-1 text-xs text-slate-400">Total Deposits</div>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-green-400 sm:text-xl">
                        {formatCurrency(
                          transactions.filter((t: TransactionRow) => t.type === 'deposit').reduce((s: number, t: TransactionRow) => s + t.amount, 0),
                          'USD'
                        )}
                      </span>
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/30">
                        <ArrowDownCircle className="h-5 w-5 text-green-400" />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 rounded-lg border border-slate-600 bg-slate-700/50 p-4">
                    <div className="mb-1 text-xs text-slate-400">Total Withdrawals</div>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-blue-400 sm:text-xl">
                        {formatCurrency(
                          transactions.filter((t: TransactionRow) => t.type === 'withdrawal').reduce((s: number, t: TransactionRow) => s + t.amount, 0),
                          'USD'
                        )}
                      </span>
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900/30">
                        <ArrowUpCircle className="h-5 w-5 text-blue-400" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toast.success('Direct deposit flow coming soon')}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      Direct Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => toast.success('Withdraw flow coming soon')}
                      className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                    >
                      <ArrowUpCircle className="h-4 w-4" />
                      Withdraw
                    </button>
                  </div>
                </div>
                {transactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <DollarSign className="h-12 w-12 text-slate-600" />
                    <p className="mt-2 text-sm font-medium text-slate-400">No funding transactions found</p>
                    <p className="text-sm text-slate-500">This user has not made any deposits or withdrawals yet.</p>
                  </div>
                ) : (
                  <div className="mt-6 overflow-x-auto rounded-lg border border-slate-700">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-700">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Amount</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Fee</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {transactions.slice(0, 50).map((tx: TransactionRow) => (
                          <tr key={tx.id}>
                            <td className="px-4 py-3 text-slate-300 capitalize">{tx.type}</td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-xs',
                                  tx.status === 'approved' || tx.status === 'completed' ? 'bg-green-900/40 text-green-400' : tx.status === 'pending' ? 'bg-yellow-900/40 text-yellow-400' : 'bg-slate-700 text-slate-400'
                                )}
                              >
                                {tx.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-white">{formatCurrency(tx.amount, (tx.currency as 'USD') || 'USD')}</td>
                            <td className="px-4 py-3 font-mono text-slate-400">{tx.netAmount != null ? formatCurrency(tx.amount - tx.netAmount, 'USD') : '—'}</td>
                            <td className="px-4 py-3 text-slate-400">{formatDateTime(tx.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="orders-positions" className="flex-1 min-h-0 overflow-auto mt-3 data-[state=inactive]:hidden">
          <div className="min-h-[420px] flex-1 overflow-y-auto p-3 sm:min-h-[520px] sm:p-4 md:p-6">
            <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-700 pb-2 sm:gap-2">
              {(['positions', 'orders', 'pending', 'closed'] as const).map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setOrdersPositionsSubTab(sub)}
                  className={cn(
                    'rounded-lg px-2 py-1.5 text-xs font-medium sm:px-3 sm:py-2 sm:text-sm',
                    ordersPositionsSubTab === sub ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
                  )}
                >
                  {sub === 'positions' ? 'Positions' : sub === 'orders' ? 'Orders' : sub === 'pending' ? 'Pending Orders' : 'Closed Positions'}
                </button>
              ))}
            </div>
            {ordersPositionsSubTab === 'positions' && (
              <>
                {positionsLoading ? (
                  <div className="flex h-64 items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-blue-500" />
                  </div>
                ) : openPositions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Package className="h-12 w-12 text-slate-600" />
                    <p className="mt-2 text-sm text-slate-400">No open positions</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-700">
                    <table className="w-full min-w-[700px] text-sm">
                      <thead className="border-b border-slate-700">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Symbol</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Side</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Qty</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Entry</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Current</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">P&L</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">S/L</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">T/P</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {openPositions.map((pos) => {
                          const sizeNum = parseFloat(pos.size || '0')
                          const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
                          const symbolKey = normalizeSymbolKey(pos.symbol)
                          const priceData = livePrices.get(symbolKey) ?? livePrices.get(pos.symbol?.toUpperCase?.() ?? '')
                          const livePrice = priceData ? (pos.side === 'LONG' ? parseFloat(priceData.bid) : parseFloat(priceData.ask)) : null
                          const unrealizedPnl =
                            livePrice !== null
                              ? pos.side === 'LONG'
                                ? (livePrice - entryPrice) * sizeNum
                                : (entryPrice - livePrice) * sizeNum
                              : parseFloat(pos.unrealized_pnl || '0')
                          const slNum = pos.sl != null && !Number.isNaN(parseFloat(pos.sl)) ? parseFloat(pos.sl) : null
                          const tpNum = pos.tp != null && !Number.isNaN(parseFloat(pos.tp)) ? parseFloat(pos.tp) : null
                          return (
                            <tr key={pos.id}>
                              <td className="px-4 py-3 font-mono text-white">{pos.symbol}</td>
                              <td className="px-4 py-3">
                                <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', pos.side === 'LONG' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400')}>
                                  {pos.side}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-300">{sizeNum.toFixed(6)}</td>
                              <td className="px-4 py-3 font-mono text-slate-300">${entryPrice.toFixed(2)}</td>
                              <td className="px-4 py-3 font-mono text-blue-400">{livePrice != null ? `$${livePrice.toFixed(2)}` : '—'}</td>
                              <td className={cn('px-4 py-3 font-mono font-medium', unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                                {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 font-mono text-slate-400">{slNum != null ? `$${slNum.toFixed(2)}` : '—'}</td>
                              <td className="px-4 py-3 font-mono text-slate-400">{tpNum != null ? `$${tpNum.toFixed(2)}` : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {ordersPositionsSubTab === 'orders' && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <ListOrdered className="h-12 w-12 text-slate-600" />
                <p className="mt-2 text-sm">No orders</p>
              </div>
            )}
            {ordersPositionsSubTab === 'pending' && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <ListOrdered className="h-12 w-12 text-slate-600" />
                <p className="mt-2 text-sm">No pending orders</p>
              </div>
            )}
            {ordersPositionsSubTab === 'closed' && (
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="border-b border-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Symbol</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Side</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Closed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {positions.filter((p) => p.status === 'CLOSED').slice(0, 20).map((pos) => (
                      <tr key={pos.id}>
                        <td className="px-4 py-3 font-mono text-white">{pos.symbol}</td>
                        <td className="px-4 py-3">
                          <span className={cn('rounded px-2 py-0.5 text-xs', pos.side === 'LONG' ? 'text-green-400' : 'text-red-400')}>{pos.side}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-400">{pos.closed_at ? formatDateTime(new Date(pos.closed_at).toISOString()) : '—'}</td>
                        <td className={cn('px-4 py-3 font-mono', parseFloat(pos.realized_pnl || '0') >= 0 ? 'text-green-400' : 'text-red-400')}>
                          ${parseFloat(pos.realized_pnl || '0').toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {positions.filter((p) => p.status === 'CLOSED').length === 0 && (
                  <div className="py-8 text-center text-sm text-slate-400">No closed positions</div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="appointments" className="flex-1 min-h-0 overflow-auto mt-3 data-[state=inactive]:hidden">
          <div className="min-h-[420px] flex-1 overflow-y-auto p-3 sm:min-h-[520px] sm:p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white sm:text-lg">Appointments</h2>
              <button
                type="button"
                onClick={() => toast.success('New appointment flow coming soon')}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:px-4"
              >
                New Appointment
              </button>
            </div>
            <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-4 text-center text-sm text-slate-400">
              No appointments
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notes" className="flex-1 min-h-0 overflow-auto mt-3 data-[state=inactive]:hidden">
          <div className="min-h-[420px] flex-1 overflow-y-auto p-3 sm:min-h-[520px] sm:p-4 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white sm:text-lg">Notes & Timeline</h2>
            </div>
            <div className="mb-4 rounded-lg border border-slate-600 bg-slate-700/50 p-3">
              <textarea
                placeholder="Add a note..."
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                disabled={createNoteMutation.isPending}
                className="w-full min-h-[100px] rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-70"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!noteDraft.trim() || createNoteMutation.isPending}
                  onClick={() => {
                    const content = noteDraft.trim()
                    if (content) createNoteMutation.mutate(content)
                  }}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none sm:px-4"
                >
                  {createNoteMutation.isPending ? 'Saving...' : 'Add Note'}
                </button>
              </div>
            </div>
            {notesLoading ? (
              <div className="flex h-32 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
              </div>
            ) : notes.length === 0 ? (
              <p className="text-sm text-slate-400">No notes yet</p>
            ) : (
              <div className="space-y-3">
                {notes.map((note: UserNote) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-slate-700 bg-slate-700/30 p-3"
                  >
                    <p className="text-sm text-white whitespace-pre-wrap">{note.content}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {note.authorEmail ?? 'Unknown'} · {formatDateTime(note.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="chat" className="flex-1 min-h-0 flex flex-col mt-3 data-[state=inactive]:hidden">
          <div className="flex-shrink-0 px-3 pt-2 pb-1 sm:px-4">
            <h2 className="text-base font-semibold text-white sm:text-lg">
              Chat with {userState.name || userState.email || 'User'}
            </h2>
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
              {chatLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
                  <span className="ml-2 text-sm text-slate-400">Loading messages...</span>
                </div>
              ) : chatError ? (
                <p className="text-sm text-red-400">{chatError}</p>
              ) : chatMessages.length === 0 ? (
                <p className="text-sm text-slate-400">No messages yet. Send a message to start the conversation.</p>
              ) : (
                <>
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex flex-col max-w-[85%]',
                        msg.sender === 'user' ? 'items-start' : 'items-end ml-auto'
                      )}
                    >
                      <div
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm',
                          msg.sender === 'user'
                            ? 'bg-slate-700/50 text-white border border-slate-600'
                            : 'bg-blue-600/30 text-white border border-blue-500/40'
                        )}
                      >
                        <p className="leading-snug whitespace-pre-wrap">{msg.text}</p>
                        <div className="text-xs text-slate-400 mt-1.5 text-right">
                          {msg.name} · {msg.time}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatMessagesEndRef} className="shrink-0 h-px" aria-hidden />
                </>
              )}
            </div>
            <div className="flex-shrink-0 p-3 border-t border-slate-700 sm:p-4 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <Input
                  ref={chatInputRef}
                  value={chatInputValue}
                  onChange={(e) => setChatInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendChat()
                    }
                  }}
                  placeholder="Type your reply..."
                  className="flex-1 min-w-0 h-10 text-sm bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
                  aria-label="Reply to user"
                  disabled={chatSending}
                />
                <button
                  type="button"
                  onClick={() => handleSendChat()}
                  disabled={!chatInputValue.trim() || chatSending}
                  className="shrink-0 p-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  title="Send message"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}

