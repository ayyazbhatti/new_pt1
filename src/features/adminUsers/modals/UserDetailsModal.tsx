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
  ArrowDownCircle,
  ArrowUpCircle,
  Plus,
  Search,
  ChevronDown,
  Check,
  AlertCircle,
} from 'lucide-react'
import { fetchTransactions } from '@/features/adminFinance/api/finance.api'
import { fetchUserNotes, createUserNote, type UserNote } from '../api/users.api'
import { getPositionsByUserId, type Position } from '@/features/terminal/api/positions.api'
import { usePriceStream, normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import { Input } from '@/shared/ui'
import { cn } from '@/shared/utils'
import { useCanAccess } from '@/shared/utils/permissions'
import {
  getAdminConversationMessages,
  sendAdminChatMessage,
} from '@/features/support/api/supportChat.api'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'
import { requestPasswordResetOTP } from '@/shared/api/auth.api'
import type { Appointment } from '@/features/appointments/types'
import type { UserSearchResult } from '@/features/appointments/types'
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  rescheduleAppointment,
  cancelAppointment,
  completeAppointment,
  sendAppointmentReminder,
  searchUsersForAppointment,
} from '@/features/appointments/api/appointments.api'
import { AdminAppointmentsTable } from '@/features/appointments/components/AdminAppointmentsTable'
import { ViewAppointmentModal } from '@/features/appointments/modals/ViewAppointmentModal'
import { CreateAppointmentModal } from '@/features/appointments/modals/CreateAppointmentModal'
import { EditAppointmentModal } from '@/features/appointments/modals/EditAppointmentModal'
import { RescheduleModal } from '@/features/appointments/modals/RescheduleModal'
import { CancelAppointmentModal } from '@/features/appointments/modals/CancelAppointmentModal'
import { CompleteAppointmentModal } from '@/features/appointments/modals/CompleteAppointmentModal'
import { SendReminderModal } from '@/features/appointments/modals/SendReminderModal'
import { createAdminOrder } from '@/features/adminTrading/api/orders'
import { reopenAdminPositionWithParams } from '@/features/adminTrading/api/positions'
import { closeAdminPosition, reopenAdminPosition, updateAdminPositionParams } from '@/features/adminTrading/api/positions'
import type { CreateOrderRequest } from '@/features/adminTrading/types'
import { fetchAdminSymbols } from '@/features/adminTrading/api/lookups'
import * as Dialog from '@radix-ui/react-dialog'
import type { LookupSymbol } from '@/features/adminTrading/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import { Loader2, RotateCcw, Pencil } from 'lucide-react'

const USER_DETAILS_TAB_STORAGE_KEY = 'admin-user-details-modal-tab'
const ORDERS_POSITIONS_SUBTAB_STORAGE_KEY = 'admin-user-details-orders-positions-subtab'
const TAB_VALUES = ['overview', 'funding', 'appointments', 'orders-positions', 'notes', 'chat'] as const
const ORDERS_POSITIONS_SUBTAB_VALUES = ['positions', 'orders', 'pending', 'closed'] as const

function getStoredOrdersPositionsSubTab(): (typeof ORDERS_POSITIONS_SUBTAB_VALUES)[number] {
  if (typeof sessionStorage === 'undefined') return 'positions'
  const stored = sessionStorage.getItem(ORDERS_POSITIONS_SUBTAB_STORAGE_KEY)
  return ORDERS_POSITIONS_SUBTAB_VALUES.includes(stored as (typeof ORDERS_POSITIONS_SUBTAB_VALUES)[number])
    ? (stored as (typeof ORDERS_POSITIONS_SUBTAB_VALUES)[number])
    : 'positions'
}

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

interface ResetPasswordConfirmModalProps {
  email: string
  modalKey: string
}

function ResetPasswordConfirmModal({ email, modalKey }: ResetPasswordConfirmModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!email?.trim()) return
    setSending(true)
    try {
      const res = await requestPasswordResetOTP(email.trim())
      if (res.success) {
        toast.success(res.message ?? 'Password reset OTP sent to user email.')
        closeModal(modalKey)
      } else {
        toast.error(res.error ?? 'Failed to send reset')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send password reset')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-300">
        Send a password reset OTP to <strong className="text-white">{email}</strong>? The user will receive an email with a 6-digit verification code valid for 10 minutes.
      </p>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <button
          type="button"
          onClick={() => closeModal(modalKey)}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={handleSend}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-70"
        >
          {sending ? 'Sending…' : 'Send OTP'}
        </button>
      </div>
    </div>
  )
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
  const [ordersPositionsSubTab, setOrdersPositionsSubTab] = useState<'orders' | 'positions' | 'pending' | 'closed'>(getStoredOrdersPositionsSubTab)
  const [showCreateOrderForm, setShowCreateOrderForm] = useState(false)
  const [createOrderSymbols, setCreateOrderSymbols] = useState<LookupSymbol[]>([])
  const [createOrderSymbolsLoading, setCreateOrderSymbolsLoading] = useState(false)
  const [createOrderSubmitting, setCreateOrderSubmitting] = useState(false)
  const [createOrderForm, setCreateOrderForm] = useState<Omit<CreateOrderRequest, 'userId'>>({
    symbolId: '',
    side: 'BUY',
    orderType: 'MARKET',
    size: 0,
    price: undefined,
    stopPrice: undefined,
    timeInForce: 'GTC',
    stopLoss: undefined,
    takeProfit: undefined,
  })
  const [createOrderSymbolDropdownOpen, setCreateOrderSymbolDropdownOpen] = useState(false)
  const [createOrderSymbolSearch, setCreateOrderSymbolSearch] = useState('')
  const createOrderSymbolDropdownRef = useRef<HTMLDivElement>(null)
  const [closePositionDialogOpen, setClosePositionDialogOpen] = useState(false)
  const [closePositionId, setClosePositionId] = useState<string | null>(null)
  const [reopenPositionDialogOpen, setReopenPositionDialogOpen] = useState(false)
  const [reopenPositionId, setReopenPositionId] = useState<string | null>(null)
  const [reopenPositionSymbol, setReopenPositionSymbol] = useState('')
  const [closePositionSymbol, setClosePositionSymbol] = useState<string>('')
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null)
  const [reopeningPositionId, setReopeningPositionId] = useState<string | null>(null)
  const [modifyOpenDialogOpen, setModifyOpenDialogOpen] = useState(false)
  const [modifyOpenPosition, setModifyOpenPosition] = useState<Position | null>(null)
  const [modifyOpenForm, setModifyOpenForm] = useState<Omit<CreateOrderRequest, 'userId'>>({
    symbolId: '',
    side: 'BUY',
    orderType: 'MARKET',
    size: 0,
    price: undefined,
    stopPrice: undefined,
    timeInForce: 'GTC',
    stopLoss: undefined,
    takeProfit: undefined,
  })
  const [modifyOpenSubmitting, setModifyOpenSubmitting] = useState(false)

  const [modifyPositionDialogOpen, setModifyPositionDialogOpen] = useState(false)
  const [modifyPosition, setModifyPosition] = useState<Position | null>(null)
  const [modifyPositionForm, setModifyPositionForm] = useState<{ size: number; entryPrice: number; stopLoss: number | undefined; takeProfit: number | undefined }>({
    size: 0,
    entryPrice: 0,
    stopLoss: undefined,
    takeProfit: undefined,
  })
  const [modifyPositionSubmitting, setModifyPositionSubmitting] = useState(false)

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

  const canCreateOrder = useCanAccess('trading:create_order')
  const canClosePosition = useCanAccess('trading:close_position')
  const canEditApt = useCanAccess('appointments:edit')
  const canRescheduleApt = useCanAccess('appointments:reschedule')
  const canCancelApt = useCanAccess('appointments:cancel')
  const canCompleteApt = useCanAccess('appointments:complete')
  const canSendReminderApt = useCanAccess('appointments:send_reminder')

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

  // Load symbols when create-order form is shown or when Modify & open modal opens
  useEffect(() => {
    if ((showCreateOrderForm || (modifyOpenDialogOpen && modifyOpenPosition != null)) && createOrderSymbols.length === 0) {
      setCreateOrderSymbolsLoading(true)
      fetchAdminSymbols()
        .then(setCreateOrderSymbols)
        .catch(() => toast.error('Failed to load symbols'))
        .finally(() => setCreateOrderSymbolsLoading(false))
    }
  }, [showCreateOrderForm, modifyOpenDialogOpen, modifyOpenPosition, createOrderSymbols.length])
  // Prefill Modify & open form once when modal opens with a position and symbols are ready
  const lastModifyOpenPositionIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!modifyOpenDialogOpen || !modifyOpenPosition || createOrderSymbols.length === 0) return
    const pos = modifyOpenPosition
    if (lastModifyOpenPositionIdRef.current === pos.id) return
    lastModifyOpenPositionIdRef.current = pos.id
    const symbolCode = (pos.symbol || '').toUpperCase().trim()
    const lookup = createOrderSymbols.find((s) => s.code.toUpperCase() === symbolCode)
    const symbolId = lookup?.id ?? ''
    const size = parseFloat(pos.original_size || pos.size || '0') || 0
    const side = pos.side === 'LONG' ? 'BUY' : 'SELL'
    const sl = pos.sl != null && !Number.isNaN(parseFloat(pos.sl)) ? parseFloat(pos.sl) : undefined
    const tp = pos.tp != null && !Number.isNaN(parseFloat(pos.tp)) ? parseFloat(pos.tp) : undefined
    const entryPrice = pos.entry_price ?? pos.avg_price
    const price = entryPrice != null && !Number.isNaN(parseFloat(entryPrice)) ? parseFloat(entryPrice) : undefined
    setModifyOpenForm({
      symbolId,
      side,
      orderType: price != null && price > 0 ? 'LIMIT' : 'MARKET',
      size,
      price,
      stopPrice: undefined,
      timeInForce: 'GTC',
      stopLoss: sl,
      takeProfit: tp,
    })
  }, [modifyOpenDialogOpen, modifyOpenPosition, createOrderSymbols])
  useEffect(() => {
    if (!modifyOpenDialogOpen) lastModifyOpenPositionIdRef.current = null
  }, [modifyOpenDialogOpen])

  useEffect(() => {
    if (!modifyPositionDialogOpen || !modifyPosition) return
    const pos = modifyPosition
    const size = parseFloat(pos.size || '0') || 0
    const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0') || 0
    const sl = pos.sl != null && !Number.isNaN(parseFloat(pos.sl)) ? parseFloat(pos.sl) : undefined
    const tp = pos.tp != null && !Number.isNaN(parseFloat(pos.tp)) ? parseFloat(pos.tp) : undefined
    setModifyPositionForm({ size, entryPrice, stopLoss: sl, takeProfit: tp })
  }, [modifyPositionDialogOpen, modifyPosition])

  const createOrderSymbolsFiltered = useMemo(() => {
    if (!createOrderSymbolSearch.trim()) return createOrderSymbols
    const q = createOrderSymbolSearch.toLowerCase().trim()
    return createOrderSymbols.filter(
      (s) => s.code.toLowerCase().includes(q) || (s.name && s.name.toLowerCase().includes(q))
    )
  }, [createOrderSymbols, createOrderSymbolSearch])

  useEffect(() => {
    if (!createOrderSymbolDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (createOrderSymbolDropdownRef.current && !createOrderSymbolDropdownRef.current.contains(e.target as Node)) {
        setCreateOrderSymbolDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [createOrderSymbolDropdownOpen])
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

  const QUERY_KEY_APPOINTMENTS = ['admin', 'appointments'] as const
  const appointmentsParams = useMemo(
    () => ({ user_id: user.id, limit: 100 }),
    [user.id]
  )
  const { data: appointmentsData, isLoading: appointmentsLoading } = useQuery({
    queryKey: [...QUERY_KEY_APPOINTMENTS, appointmentsParams],
    queryFn: () => getAppointments(appointmentsParams),
    enabled: activeTab === 'appointments' && !!user.id,
    staleTime: 30_000,
  })
  const appointments = appointmentsData?.appointments ?? []

  const createAptMutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_APPOINTMENTS })
      toast.success('Appointment created.')
      useModalStore.getState().closeModal('create-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })
  const updateAptMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateAppointment>[1] }) => updateAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_APPOINTMENTS })
      toast.success('Appointment updated.')
      useModalStore.getState().closeModal('edit-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })
  const rescheduleAptMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof rescheduleAppointment>[1] }) => rescheduleAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_APPOINTMENTS })
      toast.success('Appointment rescheduled.')
      useModalStore.getState().closeModal('reschedule-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })
  const cancelAptMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof cancelAppointment>[1] }) => cancelAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_APPOINTMENTS })
      toast.success('Appointment cancelled.')
      useModalStore.getState().closeModal('cancel-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })
  const completeAptMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof completeAppointment>[1] }) => completeAppointment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_APPOINTMENTS })
      toast.success('Appointment marked complete.')
      useModalStore.getState().closeModal('complete-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })
  const reminderAptMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof sendAppointmentReminder>[1] }) => sendAppointmentReminder(id, payload),
    onSuccess: () => {
      toast.success('Reminder sent.')
      useModalStore.getState().closeModal('reminder-apt')
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      toast.error(err?.response?.data?.error ?? err.message)
    },
  })

  const userAsSearchResult: UserSearchResult = useMemo(
    () => ({
      id: userState.id,
      email: userState.email ?? '',
      first_name: userState.name?.split(' ')[0],
      last_name: userState.name?.split(' ').slice(1).join(' ') || undefined,
      full_name: userState.name || undefined,
    }),
    [userState.id, userState.email, userState.name]
  )

  const handleViewApt = (apt: Appointment) => {
    openModal('view-apt', <ViewAppointmentModal appointment={apt} />, { title: 'Appointment details', size: 'md' })
  }
  const handleCreateApt = () => {
    openModal(
      'create-apt',
      <CreateAppointmentModal
        onSearchUsers={(q, limit) => searchUsersForAppointment(q, limit)}
        onSubmit={(payload) => createAptMutation.mutate(payload)}
        submitting={createAptMutation.isPending}
        initialUser={userAsSearchResult}
      />,
      { title: 'Create appointment', size: 'lg' }
    )
  }
  const handleEditApt = (apt: Appointment) => {
    openModal(
      'edit-apt',
      <EditAppointmentModal
        appointment={apt}
        onSubmit={(id, payload) => updateAptMutation.mutate({ id, payload })}
        submitting={updateAptMutation.isPending}
      />,
      { title: 'Edit appointment', size: 'lg' }
    )
  }
  const handleRescheduleApt = (apt: Appointment) => {
    openModal(
      'reschedule-apt',
      <RescheduleModal
        appointment={apt}
        onSubmit={(id, payload) => rescheduleAptMutation.mutate({ id, payload })}
        submitting={rescheduleAptMutation.isPending}
      />,
      { title: 'Reschedule', size: 'md' }
    )
  }
  const handleCancelApt = (apt: Appointment) => {
    openModal(
      'cancel-apt',
      <CancelAppointmentModal
        appointment={apt}
        onSubmit={(id, payload) => cancelAptMutation.mutate({ id, payload })}
        submitting={cancelAptMutation.isPending}
      />,
      { title: 'Cancel appointment', size: 'md' }
    )
  }
  const handleCompleteApt = (apt: Appointment) => {
    openModal(
      'complete-apt',
      <CompleteAppointmentModal
        appointment={apt}
        onSubmit={(id, payload) => completeAptMutation.mutate({ id, payload })}
        submitting={completeAptMutation.isPending}
      />,
      { title: 'Mark complete', size: 'md' }
    )
  }
  const handleSendReminderApt = (apt: Appointment) => {
    openModal(
      'reminder-apt',
      <SendReminderModal
        appointment={apt}
        onSubmit={(id, payload) => reminderAptMutation.mutate({ id, payload })}
        submitting={reminderAptMutation.isPending}
      />,
      { title: 'Send reminder', size: 'lg' }
    )
  }

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
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-700 pb-2">
              <div className="flex flex-wrap gap-1 sm:gap-2">
                {(['positions', 'orders', 'pending', 'closed'] as const).map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => {
                      setOrdersPositionsSubTab(sub)
                      try {
                        sessionStorage.setItem(ORDERS_POSITIONS_SUBTAB_STORAGE_KEY, sub)
                      } catch {
                        // ignore
                      }
                    }}
                    className={cn(
                      'rounded-lg px-2 py-1.5 text-xs font-medium sm:px-3 sm:py-2 sm:text-sm',
                      ordersPositionsSubTab === sub ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
                    )}
                  >
                    {sub === 'positions' ? 'Positions' : sub === 'orders' ? 'Orders' : sub === 'pending' ? 'Pending Orders' : 'Closed Positions'}
                  </button>
                ))}
              </div>
              {canCreateOrder && (
                <button
                  type="button"
                  onClick={() => setShowCreateOrderForm((prev) => !prev)}
                  className={cn(
                    'ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium sm:px-3 sm:py-2 sm:text-sm',
                    showCreateOrderForm ? 'bg-slate-600 text-white hover:bg-slate-500' : 'bg-emerald-600 text-white hover:bg-emerald-500'
                  )}
                >
                  <Plus className="h-4 w-4" />
                  {showCreateOrderForm ? 'Hide form' : 'Create order'}
                </button>
              )}
            </div>

            {showCreateOrderForm && canCreateOrder && (
              <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Create order for this user</h3>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!createOrderForm.symbolId || createOrderForm.size <= 0) {
                      toast.error('Please fill in Symbol and Size')
                      return
                    }
                    if ((createOrderForm.orderType === 'LIMIT' || createOrderForm.orderType === 'STOP_LIMIT') && (createOrderForm.price == null || createOrderForm.price <= 0)) {
                      toast.error('Please enter a limit price')
                      return
                    }
                    setCreateOrderSubmitting(true)
                    try {
                      await createAdminOrder({ ...createOrderForm, userId: user.id })
                      toast.success('Order created successfully')
                      setCreateOrderForm({
                        symbolId: '',
                        side: 'BUY',
                        orderType: 'MARKET',
                        size: 0,
                        price: undefined,
                        stopPrice: undefined,
                        timeInForce: 'GTC',
                        stopLoss: undefined,
                        takeProfit: undefined,
                      })
                      queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
                    } catch (err: unknown) {
                      const e = err as { response?: { data?: { error?: { message?: string }; message?: string } } }
                      toast.error(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? 'Failed to create order')
                    } finally {
                      setCreateOrderSubmitting(false)
                    }
                  }}
                  className="space-y-3"
                >
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="relative" ref={createOrderSymbolDropdownRef}>
                      <Label className="text-slate-400 text-xs">Symbol *</Label>
                      <button
                        type="button"
                        onClick={() => !createOrderSymbolsLoading && setCreateOrderSymbolDropdownOpen((o) => !o)}
                        disabled={createOrderSymbolsLoading}
                        className={cn(
                          'w-full rounded-lg border px-3 py-2 h-9 text-sm text-left flex items-center justify-between gap-2',
                          'bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400',
                          'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-slate-500',
                          createOrderSymbolDropdownOpen && 'ring-2 ring-blue-500/50 border-slate-500',
                          createOrderSymbolsLoading && 'opacity-60 cursor-not-allowed'
                        )}
                      >
                        <span className="truncate">
                          {createOrderSymbolsLoading
                            ? 'Loading…'
                            : createOrderForm.symbolId
                              ? createOrderSymbols.find((s) => s.id === createOrderForm.symbolId)?.code ?? 'Select'
                              : 'Select'}
                        </span>
                        <ChevronDown
                          className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', createOrderSymbolDropdownOpen && 'rotate-180')}
                        />
                      </button>
                      {createOrderSymbolDropdownOpen && (
                        <div
                          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg bg-slate-800 border border-slate-600 shadow-xl overflow-hidden flex flex-col"
                          style={{ maxHeight: 'min(50vh, 280px)' }}
                        >
                          <div className="shrink-0 p-2 border-b border-slate-700">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                              <Input
                                placeholder="Search symbols..."
                                value={createOrderSymbolSearch}
                                onChange={(e) => setCreateOrderSymbolSearch(e.target.value)}
                                className="pl-8 h-9 text-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/50"
                                autoFocus
                              />
                            </div>
                          </div>
                          <div className="flex-1 min-h-0 overflow-y-auto">
                            {createOrderSymbolsFiltered.length === 0 ? (
                              <div className="px-3 py-4 text-center text-slate-400 text-sm">No symbols match</div>
                            ) : (
                              createOrderSymbolsFiltered.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => {
                                    setCreateOrderForm((f) => ({ ...f, symbolId: s.id }))
                                    setCreateOrderSymbolDropdownOpen(false)
                                    setCreateOrderSymbolSearch('')
                                  }}
                                  className={cn(
                                    'w-full px-3 py-2.5 text-left text-sm font-medium flex items-center justify-between gap-2 transition-colors',
                                    createOrderForm.symbolId === s.id
                                      ? 'bg-blue-600/20 text-blue-300'
                                      : 'text-slate-200 hover:bg-slate-700/80'
                                  )}
                                >
                                  <span className="truncate">{s.code}</span>
                                  {createOrderForm.symbolId === s.id ? <Check className="h-4 w-4 shrink-0 text-blue-400" /> : null}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs">Side *</Label>
                      <Select
                        value={createOrderForm.side}
                        onValueChange={(v) => setCreateOrderForm((f) => ({ ...f, side: v as 'BUY' | 'SELL' }))}
                      >
                        <SelectTrigger className="h-9 bg-slate-700/50 border-slate-600 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BUY">BUY</SelectItem>
                          <SelectItem value="SELL">SELL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs">Type *</Label>
                      <Select
                        value={createOrderForm.orderType}
                        onValueChange={(v) => setCreateOrderForm((f) => ({ ...f, orderType: v as CreateOrderRequest['orderType'] }))}
                      >
                        <SelectTrigger className="h-9 bg-slate-700/50 border-slate-600 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MARKET">MARKET</SelectItem>
                          <SelectItem value="LIMIT">LIMIT</SelectItem>
                          <SelectItem value="STOP">STOP</SelectItem>
                          <SelectItem value="STOP_LIMIT">STOP_LIMIT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs">Size *</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        min={0}
                        value={createOrderForm.size || ''}
                        onChange={(e) => setCreateOrderForm((f) => ({ ...f, size: parseFloat(e.target.value) || 0 }))}
                        className="h-9 bg-slate-700/50 border-slate-600 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(createOrderForm.orderType === 'LIMIT' || createOrderForm.orderType === 'STOP_LIMIT') && (
                      <div>
                        <Label className="text-slate-400 text-xs">Price *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={createOrderForm.price ?? ''}
                          onChange={(e) => setCreateOrderForm((f) => ({ ...f, price: parseFloat(e.target.value) || undefined }))}
                          className="h-9 bg-slate-700/50 border-slate-600 text-sm"
                        />
                      </div>
                    )}
                    {(createOrderForm.orderType === 'STOP' || createOrderForm.orderType === 'STOP_LIMIT') && (
                      <div>
                        <Label className="text-slate-400 text-xs">Stop price *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={createOrderForm.stopPrice ?? ''}
                          onChange={(e) => setCreateOrderForm((f) => ({ ...f, stopPrice: parseFloat(e.target.value) || undefined }))}
                          className="h-9 bg-slate-700/50 border-slate-600 text-sm"
                        />
                      </div>
                    )}
                    <div>
                      <Label className="text-slate-400 text-xs">Time in force</Label>
                      <Select
                        value={createOrderForm.timeInForce ?? 'GTC'}
                        onValueChange={(v) => setCreateOrderForm((f) => ({ ...f, timeInForce: (v || 'GTC') as 'GTC' | 'IOC' | 'FOK' }))}
                      >
                        <SelectTrigger className="h-9 bg-slate-700/50 border-slate-600 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GTC">GTC</SelectItem>
                          <SelectItem value="IOC">IOC</SelectItem>
                          <SelectItem value="FOK">FOK</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs">Stop loss (opt)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={createOrderForm.stopLoss ?? ''}
                        onChange={(e) => setCreateOrderForm((f) => ({ ...f, stopLoss: parseFloat(e.target.value) || undefined }))}
                        className="h-9 bg-slate-700/50 border-slate-600 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs">Take profit (opt)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={createOrderForm.takeProfit ?? ''}
                        onChange={(e) => setCreateOrderForm((f) => ({ ...f, takeProfit: parseFloat(e.target.value) || undefined }))}
                        className="h-9 bg-slate-700/50 border-slate-600 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={createOrderSubmitting}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-70 flex items-center gap-1.5"
                    >
                      {createOrderSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Create order
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateOrderForm(false)}
                      className="rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-500"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

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
                          {canClosePosition && (
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Action</th>
                          )}
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
                              {(canClosePosition) && (
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <div className="relative group inline-flex">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setModifyPosition(pos)
                                          setModifyPositionDialogOpen(true)
                                        }}
                                        title="Modify entry, size, SL/TP"
                                        className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs font-medium text-white bg-slate-700 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                        Modify
                                      </span>
                                    </div>
                                    <div className="relative group inline-flex">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setClosePositionId(pos.id)
                                          setClosePositionSymbol(pos.symbol)
                                          setClosePositionDialogOpen(true)
                                        }}
                                        disabled={closingPositionId === pos.id}
                                        title="Close position"
                                        className={cn(
                                          'rounded p-1.5 text-slate-400 hover:bg-red-600/80 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                        )}
                                      >
                                        {closingPositionId === pos.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <X className="h-4 w-4" />
                                        )}
                                      </button>
                                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs font-medium text-white bg-slate-700 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                        Close
                                      </span>
                                    </div>
                                  </div>
                                </td>
                              )}
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
                <table className="w-full min-w-[900px] table-fixed text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:text-ellipsis [&_td]:text-ellipsis">
                  <thead className="border-b border-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[72px]">Symbol</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[56px]">Side</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[72px]">Size</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[64px]">Entry</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[64px]">Exit</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[56px]">Leverage</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[64px]">Margin</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[100px]">Opened</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[100px]">Closed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 w-[64px]">P&L</th>
                      {(canClosePosition || canCreateOrder) && (
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400 w-[80px]">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {positions.filter((p) => p.status === 'CLOSED').slice(0, 20).map((pos) => {
                      const closedAtMs = pos.closed_at != null ? (pos.closed_at < 1e12 ? pos.closed_at * 1000 : pos.closed_at) : null
                      const openedAtMs = pos.opened_at != null ? (pos.opened_at < 1e12 ? pos.opened_at * 1000 : pos.opened_at) : null
                      return (
                        <tr key={pos.id}>
                          <td className="px-4 py-3 font-mono text-white" title={pos.symbol}>{pos.symbol}</td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-block rounded px-2 py-0.5 text-xs', pos.side === 'LONG' ? 'text-green-400' : 'text-red-400')}>{pos.side}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-300" title={parseFloat(pos.original_size || pos.size || '0').toLocaleString(undefined, { maximumFractionDigits: 6 })}>
                            {parseFloat(pos.original_size || pos.size || '0').toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-400">${parseFloat(pos.entry_price || pos.avg_price || '0').toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono text-slate-400">{pos.exit_price != null ? `$${parseFloat(pos.exit_price).toFixed(2)}` : '—'}</td>
                          <td className="px-4 py-3 font-mono text-slate-400">{pos.leverage ? `${pos.leverage}×` : '—'}</td>
                          <td className="px-4 py-3 font-mono text-slate-400">{pos.margin != null ? `$${parseFloat(pos.margin).toFixed(2)}` : '—'}</td>
                          <td className="px-4 py-3 text-slate-400" title={openedAtMs != null ? formatDateTime(new Date(openedAtMs).toISOString()) : undefined}>
                            {openedAtMs != null ? formatDateTime(new Date(openedAtMs).toISOString()) : '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-400" title={closedAtMs != null ? formatDateTime(new Date(closedAtMs).toISOString()) : undefined}>
                            {closedAtMs != null ? formatDateTime(new Date(closedAtMs).toISOString()) : '—'}
                          </td>
                          <td className={cn('px-4 py-3 font-mono', parseFloat(pos.realized_pnl || '0') >= 0 ? 'text-green-400' : 'text-red-400')}>
                            ${parseFloat(pos.realized_pnl || '0').toFixed(2)}
                          </td>
                          {(canClosePosition || canCreateOrder) && (
                            <td className="px-4 py-3 text-right !overflow-visible">
                              <div className="flex items-center justify-end gap-1">
                                {canCreateOrder && (
                                  <div className="relative group inline-flex">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setModifyOpenPosition(pos)
                                        setModifyOpenDialogOpen(true)
                                      }}
                                      title="Modify & open (change size, SL/TP then open)"
                                      className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs font-medium text-white bg-slate-700 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[100]">
                                      Modify & open
                                    </span>
                                  </div>
                                )}
                                {canClosePosition && (
                                  <div className="relative group inline-flex">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReopenPositionId(pos.id)
                                        setReopenPositionSymbol(pos.symbol)
                                        setReopenPositionDialogOpen(true)
                                      }}
                                      disabled={reopeningPositionId === pos.id}
                                      title="Re-open position (same parameters)"
                                      className={cn(
                                        'rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                                      )}
                                    >
                                      {reopeningPositionId === pos.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RotateCcw className="h-4 w-4" />
                                      )}
                                    </button>
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs font-medium text-white bg-slate-700 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[100]">
                                      Re-open
                                    </span>
                                  </div>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
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
                onClick={handleCreateApt}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 sm:px-4"
              >
                New Appointment
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-400">Showing appointments for this user.</p>
            {appointmentsLoading ? (
              <div className="flex h-32 items-center justify-center rounded-lg border border-slate-600 bg-slate-700/50">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
                <span className="ml-2 text-sm text-slate-400">Loading appointments...</span>
              </div>
            ) : (
              <AdminAppointmentsTable
                appointments={appointments}
                onView={handleViewApt}
                onEdit={handleEditApt}
                onReschedule={handleRescheduleApt}
                onCancel={handleCancelApt}
                onComplete={handleCompleteApt}
                onSendReminder={handleSendReminderApt}
                canEdit={canEditApt}
                canReschedule={canRescheduleApt}
                canCancel={canCancelApt}
                canComplete={canCompleteApt}
                canSendReminder={canSendReminderApt}
              />
            )}
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

      {/* Close position confirmation (admin) */}
      <Dialog.Root open={closePositionDialogOpen} onOpenChange={setClosePositionDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 border border-slate-600 rounded-lg p-6 z-[100] w-full max-w-md shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400" />
              Close position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-400 mb-6">
              Close position {closePositionSymbol} ({closePositionId?.slice(0, 8)}…)? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setClosePositionDialogOpen(false)
                  setClosePositionId(null)
                  setClosePositionSymbol('')
                }}
                className="px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!closePositionId) return
                  const idToClose = closePositionId
                  setClosingPositionId(idToClose)
                  try {
                    await closeAdminPosition(idToClose)
                    toast.success(`Position ${closePositionSymbol} closed successfully`)
                    setClosePositionDialogOpen(false)
                    setClosePositionId(null)
                    setClosePositionSymbol('')
                    queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { error?: { message?: string } }; status?: number }; message?: string }
                    const msg = e?.response?.data?.error?.message ?? e?.message ?? 'Failed to close position'
                    toast.error(msg)
                  } finally {
                    setClosingPositionId(null)
                  }
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-500 rounded-lg transition-colors"
              >
                Close position
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modify open position (admin): edit size, entry price, SL, TP */}
      <Dialog.Root
        open={modifyPositionDialogOpen}
        onOpenChange={(open) => {
          setModifyPositionDialogOpen(open)
          if (!open) setModifyPosition(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 border border-slate-600 rounded-lg p-6 z-[100] w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <Dialog.Title className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <Pencil className="h-5 w-5 text-blue-400" />
              Modify position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-400 mb-4">
              Update size, entry price, stop loss, or take profit for this open position.
            </Dialog.Description>
            {modifyPosition && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (modifyPositionForm.size <= 0) {
                    toast.error('Size must be greater than 0')
                    return
                  }
                  if (modifyPositionForm.entryPrice <= 0) {
                    toast.error('Entry price must be greater than 0')
                    return
                  }
                  setModifyPositionSubmitting(true)
                  try {
                    await updateAdminPositionParams(modifyPosition.id, {
                      size: modifyPositionForm.size,
                      entryPrice: modifyPositionForm.entryPrice,
                      stopLoss: modifyPositionForm.stopLoss,
                      takeProfit: modifyPositionForm.takeProfit,
                    })
                    toast.success('Position updated.')
                    setModifyPositionDialogOpen(false)
                    setModifyPosition(null)
                    queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    setTimeout(() => {
                      queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    }, 1500)
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { error?: { message?: string } }; message?: string } }
                    toast.error(e?.response?.data?.error?.message ?? e?.message ?? 'Failed to update position')
                  } finally {
                    setModifyPositionSubmitting(false)
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <Label className="text-slate-400 text-xs">Symbol</Label>
                  <div className="mt-1 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm font-mono text-white h-9 flex items-center">
                    {modifyPosition.symbol}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-400 text-xs">Size *</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      min={0}
                      value={modifyPositionForm.size || ''}
                      onChange={(e) => setModifyPositionForm((f) => ({ ...f, size: parseFloat(e.target.value) || 0 }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs">Entry price *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={modifyPositionForm.entryPrice || ''}
                      onChange={(e) => setModifyPositionForm((f) => ({ ...f, entryPrice: parseFloat(e.target.value) || 0 }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-400 text-xs">Stop loss (opt)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={modifyPositionForm.stopLoss ?? ''}
                      onChange={(e) => setModifyPositionForm((f) => ({ ...f, stopLoss: parseFloat(e.target.value) || undefined }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs">Take profit (opt)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={modifyPositionForm.takeProfit ?? ''}
                      onChange={(e) => setModifyPositionForm((f) => ({ ...f, takeProfit: parseFloat(e.target.value) || undefined }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModifyPositionDialogOpen(false)
                      setModifyPosition(null)
                    }}
                    className="px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modifyPositionSubmitting}
                    className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {modifyPositionSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Re-open position confirmation (admin) */}
      <Dialog.Root open={reopenPositionDialogOpen} onOpenChange={setReopenPositionDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 border border-slate-600 rounded-lg p-6 z-[100] w-full max-w-md shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-blue-400" />
              Re-open position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-400 mb-6">
              Re-open closed position {reopenPositionSymbol} ({reopenPositionId?.slice(0, 8)}…)? The position will be restored with the same parameters.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setReopenPositionDialogOpen(false)
                  setReopenPositionId(null)
                  setReopenPositionSymbol('')
                }}
                className="px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!reopenPositionId) return
                  const idToReopen = reopenPositionId
                  const symbolToReopen = reopenPositionSymbol
                  setReopeningPositionId(idToReopen)
                    try {
                    await reopenAdminPosition(idToReopen)
                    toast.success('Reopen sent. Position will restore shortly.')
                    setReopenPositionDialogOpen(false)
                    setReopenPositionId(null)
                    setReopenPositionSymbol('')
                    queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
                    // Refetch once after a short delay so UI updates when order-engine has processed
                    setTimeout(() => {
                      queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    }, 2500)
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { error?: { message?: string } }; status?: number }; message?: string }
                    const msg = e?.response?.data?.error?.message ?? e?.message ?? 'Failed to re-open position'
                    toast.error(msg)
                  } finally {
                    setReopeningPositionId(null)
                  }
                }}
                disabled={!!reopeningPositionId}
                className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reopeningPositionId ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Re-opening…
                  </>
                ) : (
                  'Re-open position'
                )}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modify & open position (admin): edit size/SL/TP then place market order */}
      <Dialog.Root
        open={modifyOpenDialogOpen}
        onOpenChange={(open) => {
          setModifyOpenDialogOpen(open)
          if (!open) setModifyOpenPosition(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 border border-slate-600 rounded-lg p-6 z-[100] w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <Dialog.Title className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <Pencil className="h-5 w-5 text-blue-400" />
              Modify & open position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-400 mb-4">
              Restore this closed position with your edits (same position ID). Change size, entry price, side, stop loss, or take profit.
            </Dialog.Description>
            {modifyOpenPosition && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!modifyOpenPosition || modifyOpenForm.size <= 0) {
                    toast.error('Size is required')
                    return
                  }
                  const sideForApi = modifyOpenForm.side === 'SELL' ? 'SHORT' : 'LONG'
                  setModifyOpenSubmitting(true)
                  try {
                    await reopenAdminPositionWithParams(modifyOpenPosition.id, {
                      size: modifyOpenForm.size,
                      entryPrice: modifyOpenForm.price != null && modifyOpenForm.price > 0 ? modifyOpenForm.price : undefined,
                      side: sideForApi,
                      stopLoss: modifyOpenForm.stopLoss,
                      takeProfit: modifyOpenForm.takeProfit,
                    })
                    toast.success('Position re-opened with your changes.')
                    setModifyOpenDialogOpen(false)
                    setModifyOpenPosition(null)
                    queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
                    setTimeout(() => {
                      queryClient.invalidateQueries({ queryKey: ['user-positions', user.id] })
                    }, 2500)
                  } catch (err: unknown) {
                    const e = err as { response?: { data?: { error?: { message?: string } }; message?: string } }
                    toast.error(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? 'Failed to re-open position')
                  } finally {
                    setModifyOpenSubmitting(false)
                  }
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-400 text-xs">Symbol</Label>
                    <div className="mt-1 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm font-mono text-white h-9 flex items-center">
                      {modifyOpenPosition.symbol}
                    </div>
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs">Side *</Label>
                    <Select
                      value={modifyOpenForm.side}
                      onValueChange={(v) => setModifyOpenForm((f) => ({ ...f, side: v as 'BUY' | 'SELL' }))}
                    >
                      <SelectTrigger className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BUY">BUY (LONG)</SelectItem>
                        <SelectItem value="SELL">SELL (SHORT)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-400 text-xs">Size *</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      min={0}
                      value={modifyOpenForm.size || ''}
                      onChange={(e) => setModifyOpenForm((f) => ({ ...f, size: parseFloat(e.target.value) || 0 }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs">Entry price (opt)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder="Empty = market"
                      value={modifyOpenForm.price ?? ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        setModifyOpenForm((f) => ({ ...f, price: Number.isFinite(v) && v > 0 ? v : undefined }))
                      }}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-400 text-xs">Stop loss (opt)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={modifyOpenForm.stopLoss ?? ''}
                      onChange={(e) => setModifyOpenForm((f) => ({ ...f, stopLoss: parseFloat(e.target.value) || undefined }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs">Take profit (opt)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={modifyOpenForm.takeProfit ?? ''}
                      onChange={(e) => setModifyOpenForm((f) => ({ ...f, takeProfit: parseFloat(e.target.value) || undefined }))}
                      className="mt-1 h-9 bg-slate-700/50 border-slate-600 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModifyOpenDialogOpen(false)
                      setModifyOpenPosition(null)
                    }}
                    className="px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modifyOpenSubmitting || (modifyOpenForm.size ?? 0) <= 0}
                    className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {modifyOpenSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Open with changes
                  </button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Overview tab footer: Edit Profile & Reset Password */}
      {activeTab === 'overview' && (
        <div className="flex-shrink-0 border-t border-slate-700 px-3 py-3 sm:px-4 sm:py-4 bg-slate-800/80 flex flex-wrap items-center gap-3">
          {isEditMode ? (
            <>
              <p className="text-xs text-blue-400">✏️ Edit mode — Make changes and click Save</p>
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
                disabled={!userState.email}
                onClick={() => {
                  if (!userState.email?.trim()) return
                  openModal(
                    'reset-pwd',
                    <ResetPasswordConfirmModal email={userState.email} modalKey="reset-pwd" />,
                    { title: 'Reset password', size: 'sm' }
                  )
                }}
                className="flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-70 sm:px-4 sm:text-base"
              >
                <Key className="h-4 w-4" />
                Reset Password
              </button>
            </>
          )}
        </div>
      )}

    </>
  )
}

