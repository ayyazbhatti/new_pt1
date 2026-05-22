import { Columns, Download, Wallet, TrendingUp, Shield, DollarSign, Gift, Gauge, ArrowUpRight, ArrowDownRight, X, Edit, Trash2, XCircle, Package, FileText, History, AlertCircle, Maximize2, Minimize2, Search, MoreVertical, ChevronDown } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'
import * as Dialog from '@radix-ui/react-dialog'
import { Input, Skeleton } from '@/shared/ui'
import {
  getOpenPositions,
  getClosedPositions,
  Position,
  updatePositionSltp,
  closePosition,
} from '../api/positions.api'
import { listOrders, Order, cancelOrder as cancelOrderApi } from '../api/orders.api'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWalletStore } from '@/shared/store/walletStore'
import { usePriceStreamConnection } from '@/features/symbols/hooks/usePriceStream'
import {
  BottomDockCloseProfitableOnlyDialogBody,
  BottomDockLiveProfitablePresence,
} from './BottomDockCloseProfitableLive'
import {
  BottomDockDesktopOpenPositionRow,
  BottomDockMobileOpenPositionCard,
} from './BottomDockOpenPositionRows'
import { wsClient } from '@/shared/ws/wsClient'
import { getWsGatewayUrl } from '@/shared/ws/wsGatewayUrl'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useTerminalStore } from '../store/terminalStore'
import { useFormatDateTime, useFormatDateTimeSeconds, useFormatTime } from '@/shared/datetime'
import { useFormatFromUsd, useFormatSignedFromUsd, useFormatConverted, useFormatAmount } from '@/shared/currency'
import type { MockSymbol } from '@/shared/mock/terminalMock'
import { closedPositionPnlParts, PositionPnLBreakdown } from '@/shared/components/PositionPnLBreakdown'
import { formatPositionSize } from '@/shared/finance/sizeFormat'
import { useSymbolMetaLookup, getSymbolMetaForCode } from '../hooks/useSymbolMetaLookup'

/** User-friendly message for close position errors (403 = trading disabled, else use API message). */
function closePositionErrorMessage(err: unknown): string {
  const anyErr = err as { response?: { data?: { error?: { message?: string } }; status?: number }; message?: string }
  const apiMessage = anyErr.response?.data?.error?.message
  if (apiMessage) return apiMessage
  if (anyErr.response?.status === 403 || (typeof anyErr.message === 'string' && anyErr.message.includes('403'))) {
    return 'Trading is disabled. You cannot close positions.'
  }
  return err instanceof Error ? err.message : 'Failed to close position'
}

/** Normalize position id so optimistic remove / tombstones match REST + WS regardless of UUID casing. */
function canonicalPositionId(id: string): string {
  return id.trim().toLowerCase()
}

function copyToClipboard(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error('Failed to copy')
  )
}

function resolveQuoteCurrency(posSymbol: string, symbols: MockSymbol[]): string {
  const key = posSymbol.trim().toUpperCase()
  const s = symbols.find(
    (x) =>
      x.code.toUpperCase() === key ||
      (x.priceLookupKey != null && String(x.priceLookupKey).toUpperCase() === key),
  )
  return s?.quoteCurrency ?? 'USD'
}

const WS_POSITION_GRACE_MS = 5000

/** Merge REST open positions with local rows WS appended before Redis is consistent. REST wins for any id it returns. */
function mergePositions(
  restPositions: Position[],
  currentPositions: Position[],
  wsAppendedAt: Map<string, number>,
  graceMs: number,
): Position[] {
  const now = Date.now()
  const restById = new Map(restPositions.map((p) => [canonicalPositionId(p.id), p]))
  const merged: Position[] = [...restPositions]

  for (const local of currentPositions) {
    const localKey = canonicalPositionId(local.id)
    if (restById.has(localKey)) continue
    if (local.status !== 'OPEN') continue
    const appendedAt = wsAppendedAt.get(localKey)
    if (appendedAt == null) continue
    if (now - appendedAt > graceMs) {
      wsAppendedAt.delete(localKey)
      continue
    }
    merged.push(local)
  }

  for (const id of Array.from(wsAppendedAt.keys())) {
    if (restById.has(id)) wsAppendedAt.delete(id)
  }

  return merged
}

/** After client-side close, GET open positions can briefly still return OPEN (Redis lag). Omit those rows until the server catches up. */
const POSITION_CLOSE_TOMBSTONE_MS = 25_000
const POSITION_CLOSE_TOMBSTONE_MAX_MS = 60_000

function filterRestAfterClientClose(rest: Position[], tombstones: Map<string, number>): Position[] {
  const now = Date.now()
  for (const [id, ts] of tombstones.entries()) {
    if (now - ts > POSITION_CLOSE_TOMBSTONE_MAX_MS) tombstones.delete(id)
  }
  const filtered = rest.filter((p) => {
    const key = canonicalPositionId(p.id)
    const ts = tombstones.get(key)
    if (ts == null) return true
    if (p.status === 'OPEN' && now - ts < POSITION_CLOSE_TOMBSTONE_MS) return false
    return true
  })
  for (const id of Array.from(tombstones.keys())) {
    if (!rest.some((p) => canonicalPositionId(p.id) === id)) tombstones.delete(id)
  }
  return filtered
}

export interface BottomDockProps {
  /** When true (e.g. mobile Positions tab), dock fills available height instead of fixed 300px. */
  fullHeight?: boolean
  /** When set, only show content for this tab (no tab strip). Used by TerminalPositionsView. */
  standaloneTab?: 'positions' | 'orders'
}

export function BottomDock({ fullHeight = false, standaloneTab }: BottomDockProps = {}) {
  const WS_HEARTBEAT_INTERVAL_MS = 10_000
  const WS_STALE_TIMEOUT_MS = 30_000
  // Valid tab IDs
  const validTabs = ['positions', 'orders', 'order-history', 'position-history']
  const effectiveTab = standaloneTab ?? null

  // Load active tab from localStorage, default to 'positions'
  // Validate that the saved tab is one of the valid tabs
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem('bottomDockActiveTab')
    // Validate saved tab is still valid
    if (savedTab && validTabs.includes(savedTab)) {
      return savedTab
    }
    return 'positions'
  })
  /** Per-tab loading so Orders fetch never hides Positions (shared flag caused skeleton stuck on tab switch). */
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [closedPositionsLoading, setClosedPositionsLoading] = useState(false)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false)
  const [closeAllDialogOpen, setCloseAllDialogOpen] = useState(false)
  const [closeAllLoading, setCloseAllLoading] = useState(false)
  const [closePositionDialogOpen, setClosePositionDialogOpen] = useState(false)
  const [closePositionId, setClosePositionId] = useState<string | null>(null)
  const [cancelOrderDialogOpen, setCancelOrderDialogOpen] = useState(false)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<{ type: 'position' | 'order'; id: string } | null>(null)
  const [editSl, setEditSl] = useState<string>('') // SL price
  const [editTp, setEditTp] = useState<string>('') // TP price
  const [editSlAmount, setEditSlAmount] = useState<string>('') // SL dollar amount
  const [editTpAmount, setEditTpAmount] = useState<string>('') // TP dollar amount
  const [editingPosition, setEditingPosition] = useState<Position | null>(null) // Store position being edited
  /** Open positions only (fast API path). */
  const [positions, setPositions] = useState<Position[]>([])
  /** Closed/liquidated — loaded when Position History tab is opened. */
  const [closedPositions, setClosedPositions] = useState<Position[]>([])
  const closedPositionsLoadedRef = useRef(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [isBottomDockFullscreen, setIsBottomDockFullscreen] = useState(false)
  const bottomDockRef = useRef<HTMLDivElement>(null)
  const [filledOrders, setFilledOrders] = useState<Order[]>([])
  const { accountSummary } = useAccountSummary()
  const formatDateTime = useFormatDateTime()
  const formatDateTimeSeconds = useFormatDateTimeSeconds()
  const formatTime = useFormatTime()
  const formatMoney = useFormatFromUsd()
  const formatSigned = useFormatSignedFromUsd()
  const formatConv = useFormatConverted()
  const formatAmt = useFormatAmount()
  const symbolMetaLookup = useSymbolMetaLookup()
  const positionPendingClose = useMemo(() => {
    if (!closePositionId) return null
    const key = canonicalPositionId(closePositionId)
    return positions.find((p) => canonicalPositionId(p.id) === key) ?? null
  }, [closePositionId, positions])

  const closeDialogSizeFmt = useMemo(() => {
    if (!positionPendingClose) return null
    return formatPositionSize(
      parseFloat(positionPendingClose.size || '0'),
      getSymbolMetaForCode(symbolMetaLookup, positionPendingClose.symbol),
    )
  }, [positionPendingClose, symbolMetaLookup])
  const formatMoneyRef = useRef(formatMoney)
  formatMoneyRef.current = formatMoney
  const terminalSymbols = useTerminalStore((s) => s.symbols)
  const tradingAccess = useAuthStore((s) => s.user?.tradingAccess ?? 'full')
  const canClosePosition = tradingAccess !== 'disabled'
  const [formulaTooltip, setFormulaTooltip] = useState<{ formula: string; rect: DOMRect } | null>(null)
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null)
  const [expandedHistoryPositionId, setExpandedHistoryPositionId] = useState<string | null>(null)
  const [actionMenuPositionId, setActionMenuPositionId] = useState<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressHandledRef = useRef(false)
  /** For fetchFilledOrders error toast: matches visible tab (handles standaloneTab). */
  const visibleDockTabRef = useRef(effectiveTab ?? activeTab)
  visibleDockTabRef.current = effectiveTab ?? activeTab
  const setMobileTab = useTerminalStore((s) => s.setMobileTab)
  const openPositionsRefreshNonce = useTerminalStore((s) => s.openPositionsRefreshNonce)
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const lastWsMessageAtRef = useRef<number>(Date.now())
  // Prevent eventual-consistency flicker: once terminal says an order is terminal, don't re-show it as pending.
  const terminalOrderTombstonesRef = useRef<Map<string, number>>(new Map())
  const [positionsSearchQuery, setPositionsSearchQuery] = useState('')
  const [positionsSearchOpen, setPositionsSearchOpen] = useState(false)
  const positionsSearchInputRef = useRef<HTMLInputElement>(null)
  const [positionsOptionsMenuOpen, setPositionsOptionsMenuOpen] = useState(false)
  const [closeProfitableOnlyDialogOpen, setCloseProfitableOnlyDialogOpen] = useState(false)
  const [closeProfitableOnlyLoading, setCloseProfitableOnlyLoading] = useState(false)
  /** Live gate for “Close only profitable” (updated only when a position crosses profitable / not). */
  const [dockHasProfitableLive, setDockHasProfitableLive] = useState(false)
  /** When WS appended an open row before REST/Redis lists it; used to avoid stale GET wiping the row. */
  const wsAppendedAtRef = useRef<Map<string, number>>(new Map())
  /** Position ids we closed locally; suppress stale OPEN from REST for a short window (mergePositions re-add bug). */
  const positionCloseTombstonesRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const el = bottomDockRef.current
    if (!el) return
    const onFullscreenChange = () =>
      setIsBottomDockFullscreen(!!document.fullscreenElement && document.fullscreenElement === el)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleBottomDockFullscreen = useCallback(async () => {
    const el = bottomDockRef.current
    if (!el) return
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
  }, [])

  const sortedOpenPositions = useMemo(() => {
    return positions
      .filter((p) => p.status === 'OPEN')
      .sort((a, b) => {
        const aTime = a.opened_at || a.updated_at || 0
        const bTime = b.opened_at || b.updated_at || 0
        return bTime - aTime
      })
  }, [positions])

  useEffect(() => {
    if (sortedOpenPositions.length === 0) setDockHasProfitableLive(false)
  }, [sortedOpenPositions.length])

  // Get symbols from open positions for price streaming (subscription only; row cells use useSymbolPrice).
  const positionSymbols = useMemo(() => {
    const symbols = sortedOpenPositions
      .map((p) => p.symbol.toUpperCase())
      .filter((symbol, index, self) => self.indexOf(symbol) === index)
    return symbols
  }, [sortedOpenPositions])

  usePriceStreamConnection(positionSymbols)

  // Mobile positions list filtered by search (symbol or side)
  const mobileFilteredOpenPositions = useMemo(() => {
    const q = positionsSearchQuery.trim().toLowerCase()
    if (!q) return sortedOpenPositions
    return sortedOpenPositions.filter((pos) => {
      const symbolMatch = (pos.symbol || '').toLowerCase().includes(q)
      const sideMatch =
        (pos.side || '').toLowerCase().includes(q) ||
        (pos.side === 'LONG' && q === 'buy') ||
        (pos.side === 'SHORT' && q === 'sell')
      return symbolMatch || sideMatch
    })
  }, [sortedOpenPositions, positionsSearchQuery])

  useEffect(() => {
    if (positionsSearchOpen) {
      positionsSearchInputRef.current?.focus()
    }
  }, [positionsSearchOpen])

  const tabs = [
    { id: 'positions', label: 'Positions' },
    { id: 'orders', label: 'Orders' },
    { id: 'order-history', label: 'Order History' },
    { id: 'position-history', label: 'Position History' },
  ]
  
  // Handler to change tab and persist to localStorage
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId)
    localStorage.setItem('bottomDockActiveTab', tabId)
  }, [])

  // Fetch open positions only (fast path — skips closed history in Redis).
  const fetchOpenPositions = useCallback(async (silent?: boolean) => {
    if (!silent) setPositionsLoading(true)
    try {
      const data = await getOpenPositions()
      const filtered = filterRestAfterClientClose(data, positionCloseTombstonesRef.current)
      setPositions((current) =>
        mergePositions(filtered, current, wsAppendedAtRef.current, WS_POSITION_GRACE_MS)
      )
      return data
    } catch (error: unknown) {
      console.error('❌ Failed to fetch open positions:', error)
      if (!silent) toast.error('Failed to load positions')
      return null
    } finally {
      if (!silent) setPositionsLoading(false)
    }
  }, [])

  const fetchClosedPositions = useCallback(async (silent?: boolean) => {
    if (!silent) setClosedPositionsLoading(true)
    try {
      const data = await getClosedPositions({ limit: 200 })
      setClosedPositions(data)
      closedPositionsLoadedRef.current = true
      return data
    } catch (error: unknown) {
      console.error('❌ Failed to fetch position history:', error)
      if (!silent) toast.error('Failed to load position history')
      return null
    } finally {
      if (!silent) setClosedPositionsLoading(false)
    }
  }, [])

  // Fetch orders from API. `silent` avoids loading overlay (use after WS/on-demand events).
  const fetchOrders = useCallback(async (silent?: boolean) => {
    if (!silent) setOrdersLoading(true)
    try {
      const [pendingData, cancellingData] = await Promise.all([
        listOrders({ status: 'pending', limit: 100 }),
        listOrders({ status: 'cancelling', limit: 100 }),
      ])
      const byId = new Map<string, Order>()
      for (const o of [...pendingData.items, ...cancellingData.items]) {
        byId.set(o.id, o)
      }
      const data = { items: Array.from(byId.values()), total: byId.size }
      const now = Date.now()
      const tombstones = terminalOrderTombstonesRef.current
      // Keep tombstones bounded and self-cleaning.
      for (const [orderId, ts] of tombstones.entries()) {
        if (now - ts > 10 * 60 * 1000) tombstones.delete(orderId)
      }
      setOrders(data.items.filter((o) => !tombstones.has(o.id)))
    } catch (error: any) {
      console.error('Failed to fetch orders:', error)
      if (!silent) toast.error('Failed to load orders')
    } finally {
      if (!silent) setOrdersLoading(false)
    }
  }, [])

  // Fetch filled orders from API
  const fetchFilledOrders = useCallback(async () => {
    try {
      const data = await listOrders({ status: 'filled', limit: 100 })
      setFilledOrders(data.items)
    } catch (error: any) {
      console.error('❌ Failed to fetch filled orders:', error)
      if (visibleDockTabRef.current === 'order-history') {
        toast.error('Failed to load order history')
      }
    }
  }, [])

  // Place order / fill observed elsewhere in terminal: reconcile lists (event-driven, not polling).
  useEffect(() => {
    if (openPositionsRefreshNonce === 0) return
    void fetchOpenPositions(true)
    void fetchOrders(true)
    const t = window.setTimeout(() => void fetchOpenPositions(true), 450)
    const t2 = window.setTimeout(() => void fetchOpenPositions(true), 1100)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [openPositionsRefreshNonce, fetchOpenPositions, fetchOrders])

  // Initial fetch on mount — open positions only; closed history loads when tab is opened.
  useEffect(() => {
    void fetchOpenPositions()
    void fetchOrders()
  }, [fetchOpenPositions, fetchOrders])

  // WebSocket for real-time position/order updates with reconnection (no polling)
  useEffect(() => {
    const wsUrl = getWsGatewayUrl()
    let reconnectAttempts = 0
    const maxReconnectAttempts = 30
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null
    let mounted = true
    let authHandledForCurrentSocket = false

    function scheduleReconnect() {
      if (!mounted || reconnectAttempts >= maxReconnectAttempts) return
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
      reconnectAttempts++
      reconnectTimeout = setTimeout(connect, delay)
    }

    function connect() {
      if (!mounted) return
      const accessToken = useAuthStore.getState().accessToken
      if (!accessToken) {
        console.warn('No access token available for WebSocket authentication')
        return
      }

      // This guard is per-socket; reset on every new connection/reconnect.
      authHandledForCurrentSocket = false
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mounted || wsRef.current !== ws) return
        reconnectAttempts = 0
        setWsConnected(true)
        lastWsMessageAtRef.current = Date.now()
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }
        heartbeatInterval = setInterval(() => {
          if (!mounted || wsRef.current !== ws) return
          if (ws.readyState !== WebSocket.OPEN) return
          const now = Date.now()
          if (now - lastWsMessageAtRef.current > WS_STALE_TIMEOUT_MS) {
            console.warn('WebSocket stale in BottomDock; forcing reconnect')
            ws.close()
            return
          }
          try {
            ws.send(JSON.stringify({ type: 'ping' }))
          } catch (error) {
            console.warn('Failed to send BottomDock WebSocket ping:', error)
          }
        }, WS_HEARTBEAT_INTERVAL_MS)
        try {
          ws.send(JSON.stringify({ type: 'auth', token: accessToken }))
        } catch (error) {
          console.error('Failed to send auth message:', error)
        }
      }

      ws.onmessage = (event) => {
        try {
          lastWsMessageAtRef.current = Date.now()
          const data = JSON.parse(event.data)

          if (data.type === 'auth_success') {
            if (!mounted || wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return
            if (authHandledForCurrentSocket) return
            authHandledForCurrentSocket = true
            ws.send(JSON.stringify({ type: 'subscribe', symbols: [], channels: ['positions', 'orders', 'balances', 'wallet'] }))
            // One-shot reconcile after reconnect/auth to recover any missed WS events.
            void fetchOrders(true)
            void fetchOpenPositions(true)
            void fetchFilledOrders()
          } else if (data.type === 'wallet.balance.updated') {
            const payload = data.payload
            if (payload && typeof payload === 'object') {
              const pl = payload as Record<string, unknown>
              const normalizeUserId = (id: string | undefined | null): string => {
                if (!id) return ''
                return String(id).trim().toLowerCase().replace(/-/g, '')
              }
              const eventUserId = normalizeUserId((pl.userId ?? pl.user_id) as string | undefined)
              const currentUserId = normalizeUserId(useAuthStore.getState().user?.id as string | undefined)
              if (eventUserId && currentUserId && eventUserId === currentUserId) {
                const newBalance = Number(pl.balance ?? pl.available ?? 0)
                const currentBalance = useWalletStore.getState().balance
                const isInitialLoad = currentBalance === 0
                useWalletStore.getState().setLoading(false)
                useWalletStore.getState().setWalletData({
                  balance: newBalance,
                  currency: (pl.currency as string) ?? 'USD',
                  available: Number(pl.available ?? pl.balance ?? 0),
                  locked: Number(pl.locked ?? 0),
                  equity: Number(pl.equity ?? pl.balance ?? 0),
                  margin_used: Number(pl.margin_used ?? pl.marginUsed ?? 0),
                  free_margin: Number(pl.free_margin ?? pl.freeMargin ?? 0),
                })
                if (!isInitialLoad && currentBalance !== newBalance) {
                  const isIncrease = newBalance > currentBalance
                  const balLabel = formatMoneyRef.current(newBalance)
                  const msg = isIncrease
                    ? `Deposit approved – balance updated: ${balLabel}`
                    : `Balance updated: ${balLabel}`
                  toast.success(msg, { duration: 3000 })
                }
              }
            }
          } else if (data.type === 'auth_error') {
            console.error('❌ WebSocket authentication failed:', data.error)
            toast.error(`WebSocket auth failed: ${data.error}`)
          }

          if (data.type === 'position_update') {
            const positionId = data.position_id as string
            if (!positionId) return
            const pid = canonicalPositionId(positionId)
            const positionStatus = (data.status || 'OPEN').toUpperCase() as 'OPEN' | 'CLOSED' | 'LIQUIDATED'
            const isOpen = positionStatus === 'OPEN'

            setPositions(prev => {
              const existing = prev.findIndex((p) => canonicalPositionId(p.id) === pid)
              if (existing >= 0) {
                if (positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED') {
                  wsAppendedAtRef.current.delete(pid)
                  positionCloseTombstonesRef.current.set(pid, Date.now())
                  return prev.filter((p) => canonicalPositionId(p.id) !== pid)
                }
                const updated = [...prev]
                updated[existing] = {
                  ...updated[existing],
                  id: positionId,
                  symbol: data.symbol || updated[existing].symbol,
                  side: (data.side || updated[existing].side) as 'LONG' | 'SHORT',
                  size: data.quantity || updated[existing].size,
                  unrealized_pnl: data.unrealized_pnl || updated[existing].unrealized_pnl,
                  status: positionStatus,
                  updated_at: Date.now(),
                }
                return updated
              }
              if (isOpen) {
                const tombTs = positionCloseTombstonesRef.current.get(pid)
                if (tombTs != null && Date.now() - tombTs < POSITION_CLOSE_TOMBSTONE_MS) {
                  return prev
                }
                const newPosition: Position = {
                  id: positionId,
                  user_id: '',
                  symbol: data.symbol || '',
                  side: (data.side === 'LONG' || data.side === 'long' ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
                  size: data.quantity || '0',
                  original_size: undefined,
                  entry_price: '0',
                  avg_price: '0',
                  exit_price: undefined,
                  sl: undefined,
                  tp: undefined,
                  leverage: '50',
                  margin: '0',
                  unrealized_pnl: data.unrealized_pnl || '0',
                  realized_pnl: '0',
                  status: positionStatus,
                  opened_at: Date.now(),
                  updated_at: Date.now(),
                  closed_at: undefined,
                }
                wsAppendedAtRef.current.set(pid, Date.now())
                setTimeout(() => {
                  void fetchOpenPositions(true)
                  void fetchOrders(true)
                }, 500)
                return [...prev, newPosition]
              }
              if (positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED') {
                wsAppendedAtRef.current.delete(pid)
                positionCloseTombstonesRef.current.set(pid, Date.now())
                return prev.filter((p) => canonicalPositionId(p.id) !== pid)
              }
              return prev
            })
          }

          if (data.type === 'position_update' && data.trigger_reason) {
            const triggerReason = data.trigger_reason
            if (triggerReason === 'SL' || triggerReason === 'TP') {
              const triggerType = triggerReason === 'SL' ? 'Stop Loss' : 'Take Profit'
              const msg = `🎯 ${triggerType} Triggered! ${data.side || ''} ${data.symbol || ''} position closed`
              if (triggerReason === 'SL') {
                toast.error(msg, { duration: 5000 })
              } else {
                toast.success(msg, { duration: 5000 })
              }
            }
          }

          if (data.type === 'order_update' || data.type === 'order.update' || data.type === 'order_updated') {
            // ws-gateway sends flat: { type, order_id, status, symbol, side, quantity, price, ts } (no payload)
            // Some paths may still nest in payload — support both
            const raw: Record<string, unknown> = data.payload && typeof data.payload === 'object'
              ? (data.payload as Record<string, unknown>)
              : (data as Record<string, unknown>)
            const orderId = String(
              (raw.order_id as string) ?? (raw.orderId as string) ?? ''
            ).trim()
            const stRaw = ((raw.status as string) || '').trim()
            const st = stRaw.toUpperCase()
            if (orderId) {
              setOrders((prev) => {
                const existing = prev.findIndex((o) => o.id === orderId)
                if (existing >= 0) {
                  if (st === 'FILLED' || st === 'CANCELLED' || st === 'REJECTED') {
                    terminalOrderTombstonesRef.current.set(orderId, Date.now())
                    if (st === 'FILLED') {
                      void fetchOpenPositions(true)
                      void fetchFilledOrders()
                      setTimeout(() => void fetchOpenPositions(true), 600)
                    }
                    return prev.filter((_, i) => i !== existing)
                  }
                  const updated = [...prev]
                  const qty = String(raw.quantity ?? (raw as { filled_size?: string }).filled_size ?? '')
                  const px =
                    (raw.price as string) ?? (raw as { avg_fill_price?: string }).avg_fill_price
                  updated[existing] = {
                    ...updated[existing],
                    status: (st === 'CANCELLING' ? 'cancelling' : stRaw.toLowerCase()) || updated[existing].status,
                    filled_size: qty || updated[existing].filled_size,
                    avg_fill_price:
                      (typeof px === 'string' ? px : px != null ? String(px) : undefined) ||
                      updated[existing].avg_fill_price,
                  } as Order
                  return updated
                }
                if (st === 'PENDING') {
                  return [
                    ...prev,
                    {
                      id: orderId,
                      symbol: (raw.symbol as string) || 'UNKNOWN',
                      side: (raw.side as string) || 'BUY',
                      order_type: 'MARKET',
                      size: String((raw as { quantity?: string }).quantity || '0'),
                      price: (raw as { price?: string }).price,
                      status: 'pending',
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    } as Order,
                  ]
                }
                return prev
              })
              // Reconcile positions/orders even when terminal update arrives for an order
              // that is not currently present in local pending state.
              if (st === 'FILLED' || st === 'CANCELLED' || st === 'REJECTED') {
                void fetchOrders(true)
                if (st === 'FILLED') {
                  void fetchOpenPositions(true)
                  void fetchFilledOrders()
                  setTimeout(() => void fetchOpenPositions(true), 600)
                }
              }
            } else {
              // Safety fallback: if an order update arrives without usable id, reconcile pending once.
              void fetchOrders(true)
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      ws.onerror = () => {
        // Can happen during connect/reconnect; onclose will trigger reconnect
        if (ws.readyState !== WebSocket.CONNECTING) {
          console.warn('WebSocket error (position/order stream)')
        }
      }

      ws.onclose = () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval)
          heartbeatInterval = null
        }
        if (wsRef.current === ws) wsRef.current = null
        setWsConnected(false)
        if (mounted) scheduleReconnect()
      }
    }

    connect()
    return () => {
      mounted = false
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (heartbeatInterval) clearInterval(heartbeatInterval)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [fetchOpenPositions, fetchOrders, fetchFilledOrders])

  const tabForContent = effectiveTab ?? activeTab

  // Per-tab data: open positions refresh when returning to Positions; history loads once per session.
  useEffect(() => {
    const tab = effectiveTab ?? activeTab
    if (tab === 'positions') {
      void fetchOpenPositions(true)
    } else if (tab === 'orders') {
      void fetchOrders()
    } else if (tab === 'order-history') {
      setOrderHistoryLoading(true)
      void fetchFilledOrders().finally(() => setOrderHistoryLoading(false))
    } else if (tab === 'position-history') {
      if (!closedPositionsLoadedRef.current) {
        void fetchClosedPositions()
      } else {
        void fetchClosedPositions(true)
      }
    }
  }, [activeTab, effectiveTab, fetchOpenPositions, fetchClosedPositions, fetchOrders, fetchFilledOrders])

  // WebSocket handles real-time updates, no polling needed

  return (
    <div
      ref={bottomDockRef}
      className={cn(
        'min-h-0 overflow-hidden flex flex-col border-t border-slate-200 dark:border-white/5 bg-gradient-to-b from-surface to-surface-2/30 shadow-lg shadow-slate-400/15 dark:shadow-black/10',
        isBottomDockFullscreen ? 'h-screen' : fullHeight ? 'flex-1 min-h-0' : 'h-[300px]'
      )}
    >
      {/* Tab Strip + Toolbar: hide when standaloneTab is set (parent shows sub-tabs) */}
      {!effectiveTab && (
      <div className="shrink-0 min-h-12 border-b border-slate-200 dark:border-white/5 flex items-center justify-between gap-2 px-3 sm:px-4 bg-gradient-to-r from-slate-100/70 dark:from-white/[0.02] to-transparent">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-thin py-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                'shrink-0 px-3 py-2 text-xs font-bold transition-all duration-200 uppercase tracking-wider whitespace-nowrap relative',
                'md:rounded-lg',
                activeTab === tab.id
                  ? 'text-accent border-b-2 border-accent pb-2 -mb-px md:bg-accent md:text-white md:shadow-md md:shadow-accent/20 md:border-b-0 md:pb-2'
                  : 'text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text border-b-2 border-transparent md:border-b-0 md:hover:bg-slate-200/80 dark:md:hover:bg-surface-2/50'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent dark:bg-white hidden md:block" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {activeTab === 'positions' && (
            <button
              onClick={() => setCloseAllDialogOpen(true)}
              disabled={!canClosePosition || positions.filter(p => p.status === 'OPEN').length === 0}
              className="px-2 py-2 sm:px-3 sm:py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 rounded-lg transition-all duration-200 flex items-center gap-1.5 border border-transparent disabled:opacity-50 disabled:pointer-events-none min-h-[44px] sm:min-h-0"
              title={!canClosePosition ? 'Trading is disabled' : 'Close All Positions'}
            >
              <XCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5 shrink-0" />
              <span className="hidden sm:inline">Close All</span>
            </button>
          )}
          <button
            onClick={() => toast('Column customization coming soon')}
            className="hidden sm:flex px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-2 rounded-lg transition-all duration-200 items-center gap-1.5"
            title="Customize Columns"
          >
            <Columns className="h-3.5 w-3.5" />
            <span>Columns</span>
          </button>
          <button
            onClick={() => toast.success('Data exported successfully')}
            className="hidden sm:flex px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-2 rounded-lg transition-all duration-200 items-center gap-1.5"
            title="Export Data"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </button>
          <button
            type="button"
            onClick={toggleBottomDockFullscreen}
            className="p-2 hover:bg-surface-2 rounded-lg transition-all duration-200 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            title={isBottomDockFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isBottomDockFullscreen ? (
              <Minimize2 className="h-4 w-4 text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text" />
            ) : (
              <Maximize2 className="h-4 w-4 text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text" />
            )}
          </button>
        </div>
      </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {tabForContent === 'positions' && (
          <>
            {positionsLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-8" variant="text" />
                    <Skeleton className="h-4 w-20" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-28" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Mobile: account summary + Positions sub-header + list (flat list like reference) */}
                <div className="md:hidden overflow-auto flex-1 min-h-0 p-3 space-y-4">
                  {/* Account Summary - flat label/value list, no card border */}
                  <section className="space-y-2 py-1">
                    {[
                      { label: 'Balance', value: accountSummary != null ? formatMoney(accountSummary.balance) : '—', valueClass: 'text-text' },
                      { label: 'Equity', value: accountSummary != null ? formatMoney(accountSummary.equity) : '—', valueClass: 'text-text' },
                      { label: 'Margin', value: accountSummary != null ? formatMoney(accountSummary.marginLevel === 'inf' ? 0 : accountSummary.marginUsed) : '—', valueClass: 'text-text' },
                      { label: 'Free Margin', value: accountSummary != null ? formatMoney(accountSummary.freeMargin) : '—', valueClass: 'text-text' },
                      { label: 'Margin Level (%)', value: accountSummary != null ? (accountSummary.marginLevel === 'inf' ? '∞' : `${accountSummary.marginLevel}%`) : '—', valueClass: 'text-accent font-semibold' },
                      { label: 'Total Positions', value: String(sortedOpenPositions.length), valueClass: 'text-text' },
                    ].map(({ label, value, valueClass }) => (
                      <div key={label} className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-muted">{label}</span>
                        <span className={cn('font-medium', valueClass)}>{value}</span>
                      </div>
                    ))}
                  </section>
                  {/* Positions sub-header with search and options */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text">Positions</h3>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPositionsSearchOpen((o) => !o)
                          if (!positionsSearchOpen) setPositionsSearchQuery('')
                        }}
                        className={cn(
                          'p-2 rounded-lg hover:bg-surface-2 text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text min-h-[44px] min-w-[44px] flex items-center justify-center',
                          positionsSearchOpen && 'bg-surface-2 text-text'
                        )}
                        aria-label="Search positions"
                      >
                        <Search className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPositionsOptionsMenuOpen(true)}
                        className="p-2 rounded-lg hover:bg-surface-2 text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label="More options"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                  {positionsSearchOpen && (
                    <div className="flex items-center gap-2 py-1">
                      <Search className="h-4 w-4 text-slate-600 dark:text-muted shrink-0" />
                      <Input
                        ref={positionsSearchInputRef}
                        type="text"
                        placeholder="Search by symbol or side (e.g. ETH, Buy)"
                        value={positionsSearchQuery}
                        onChange={(e) => setPositionsSearchQuery(e.target.value)}
                        className="flex-1 min-w-0 h-9 text-sm bg-background border-border"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPositionsSearchQuery('')
                          setPositionsSearchOpen(false)
                        }}
                        className="p-2 rounded-lg hover:bg-surface-2 text-slate-600 dark:text-muted hover:text-slate-900 dark:hover:text-text shrink-0"
                        aria-label="Close search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {sortedOpenPositions.length === 0 ? (
                    <div className="text-center text-slate-600 dark:text-muted py-8 text-sm">No positions found</div>
                  ) : mobileFilteredOpenPositions.length === 0 ? (
                    <div className="text-center text-slate-600 dark:text-muted py-8 text-sm">
                      No positions match &quot;{positionsSearchQuery.trim()}&quot;
                    </div>
                  ) : (
                    <>
                  {mobileFilteredOpenPositions.map((pos) => {
                    const posQuote = resolveQuoteCurrency(pos.symbol, terminalSymbols)
                    const openEditPositionPopup = () => {
                      const currentPos = positions.find((p) => p.id === pos.id)
                      if (!currentPos) return
                      setEditingPosition(currentPos)
                      setEditItem({ type: 'position', id: pos.id })
                      const slPrice = currentPos.sl && currentPos.sl !== 'null' ? currentPos.sl : ''
                      const tpPrice = currentPos.tp && currentPos.tp !== 'null' ? currentPos.tp : ''
                      setEditSl(slPrice)
                      setEditTp(tpPrice)
                      if (slPrice) {
                        const entry = parseFloat(currentPos.avg_price || currentPos.entry_price || '0')
                        const size = parseFloat(currentPos.size || '0')
                        const slNum = parseFloat(slPrice)
                        const slAmount = currentPos.side === 'LONG' ? (entry - slNum) * size : (slNum - entry) * size
                        setEditSlAmount(slAmount > 0 ? slAmount.toFixed(2) : '')
                      } else setEditSlAmount('')
                      if (tpPrice) {
                        const entry = parseFloat(currentPos.avg_price || currentPos.entry_price || '0')
                        const size = parseFloat(currentPos.size || '0')
                        const tpNum = parseFloat(tpPrice)
                        const tpAmount = currentPos.side === 'LONG' ? (tpNum - entry) * size : (entry - tpNum) * size
                        setEditTpAmount(tpAmount > 0 ? tpAmount.toFixed(2) : '')
                      } else setEditTpAmount('')
                      setEditDialogOpen(true)
                    }
                    return (
                      <BottomDockMobileOpenPositionCard
                        key={pos.id}
                        pos={pos}
                        posQuote={posQuote}
                        symbolMetaLookup={symbolMetaLookup}
                        expandedPositionId={expandedPositionId}
                        setExpandedPositionId={setExpandedPositionId}
                        formatDateTimeSeconds={formatDateTimeSeconds}
                        formatConv={formatConv}
                        formatSigned={formatSigned}
                        formatMoney={formatMoney}
                        canClosePosition={canClosePosition}
                        onOpenEdit={openEditPositionPopup}
                        onRequestClose={() => {
                          setClosePositionId(pos.id)
                          setClosePositionDialogOpen(true)
                        }}
                        setActionMenuPositionId={setActionMenuPositionId}
                        longPressHandledRef={longPressHandledRef}
                        longPressTimerRef={longPressTimerRef}
                      />
                    )
                  })}
                  {mobileFilteredOpenPositions.length > 0 && (
                    <div className="text-center text-slate-600 dark:text-muted text-xs py-3">No more data</div>
                  )}
                    </>
                  )}
                </div>
                {/* Full-width action menu popup (long-press or right-click on position) - mobile only */}
                {actionMenuPositionId && (() => {
                  const menuPosition = positions.find((p) => p.id === actionMenuPositionId)
                  if (!menuPosition) return null
                  const openEditForMenu = () => {
                    setActionMenuPositionId(null)
                    setEditingPosition(menuPosition)
                    setEditItem({ type: 'position', id: menuPosition.id })
                    const slPrice = menuPosition.sl && menuPosition.sl !== 'null' ? menuPosition.sl : ''
                    const tpPrice = menuPosition.tp && menuPosition.tp !== 'null' ? menuPosition.tp : ''
                    setEditSl(slPrice)
                    setEditTp(tpPrice)
                    if (slPrice) {
                      const entry = parseFloat(menuPosition.avg_price || menuPosition.entry_price || '0')
                      const size = parseFloat(menuPosition.size || '0')
                      const slNum = parseFloat(slPrice)
                      const slAmount = menuPosition.side === 'LONG' ? (entry - slNum) * size : (slNum - entry) * size
                      setEditSlAmount(slAmount > 0 ? slAmount.toFixed(2) : '')
                    } else setEditSlAmount('')
                    if (tpPrice) {
                      const entry = parseFloat(menuPosition.avg_price || menuPosition.entry_price || '0')
                      const size = parseFloat(menuPosition.size || '0')
                      const tpNum = parseFloat(tpPrice)
                      const tpAmount = menuPosition.side === 'LONG' ? (tpNum - entry) * size : (entry - tpNum) * size
                      setEditTpAmount(tpAmount > 0 ? tpAmount.toFixed(2) : '')
                    } else setEditTpAmount('')
                    setEditDialogOpen(true)
                  }
                  const actions = [
                    { label: 'Close position', onClick: () => { setActionMenuPositionId(null); setClosePositionId(menuPosition.id); setClosePositionDialogOpen(true); }, disabled: !canClosePosition },
                    { label: 'Modify position', onClick: () => { setActionMenuPositionId(null); openEditForMenu(); } },
                    { label: 'New order', onClick: () => { setActionMenuPositionId(null); setMobileTab('trade'); } },
                    { label: 'Chart', onClick: () => { setActionMenuPositionId(null); setMobileTab('chart'); } },
                    { label: 'Bulk Operations...', onClick: () => { setActionMenuPositionId(null); toast('Bulk operations coming soon'); } },
                  ]
                  return createPortal(
                    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
                      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/50" onClick={() => setActionMenuPositionId(null)} aria-hidden />
                      <div className="relative rounded-t-xl border-t border-slate-300 dark:border-white/10 bg-surface shadow-xl safe-area-pb">
                        <div className="divide-y divide-slate-200 dark:divide-white/10">
                          {actions.map(({ label, onClick, disabled }) => (
                            <button
                              key={label}
                              type="button"
                              onClick={onClick}
                              disabled={disabled}
                              className="w-full py-4 px-4 text-left text-sm font-medium text-text hover:bg-slate-100 dark:hover:bg-white/5 active:bg-slate-200 dark:active:bg-white/10 disabled:opacity-50 disabled:pointer-events-none"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )
                })()}
                {/* Desktop: table or empty state */}
                <div className="hidden md:block overflow-auto flex-1 min-h-0">
                  {positions.length === 0 && filledOrders.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-slate-600 dark:text-muted">
                        <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <div className="text-sm font-medium">No open positions</div>
                        <div className="text-xs mt-1">Open a position to see it here</div>
                      </div>
                    </div>
                  ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-slate-200 dark:border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Quantity</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Direction</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Margin</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Entry</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Current</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest whitespace-nowrap">P&L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">S/L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">T/P</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest whitespace-nowrap">Opened</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOpenPositions.map((pos, index) => {
                    const posQuote = resolveQuoteCurrency(pos.symbol, terminalSymbols)
                    const rowExpanded = expandedPositionId === pos.id
                    const openEditPositionPopup = () => {
                      const currentPos = positions.find((p) => p.id === pos.id)
                      if (!currentPos) return
                      setEditingPosition(currentPos)
                      setEditItem({ type: 'position', id: pos.id })
                      const slPrice = currentPos.sl && currentPos.sl !== 'null' ? currentPos.sl : ''
                      const tpPrice = currentPos.tp && currentPos.tp !== 'null' ? currentPos.tp : ''
                      setEditSl(slPrice)
                      setEditTp(tpPrice)
                      if (slPrice) {
                        const entryPrice = parseFloat(currentPos.avg_price || currentPos.entry_price || '0')
                        const sizeNum = parseFloat(currentPos.size || '0')
                        const slPriceNum = parseFloat(slPrice)
                        const slAmount = currentPos.side === 'LONG'
                          ? (entryPrice - slPriceNum) * sizeNum
                          : (slPriceNum - entryPrice) * sizeNum
                        setEditSlAmount(slAmount > 0 ? slAmount.toFixed(2) : '')
                      } else {
                        setEditSlAmount('')
                      }
                      if (tpPrice) {
                        const entryPrice = parseFloat(currentPos.avg_price || currentPos.entry_price || '0')
                        const sizeNum = parseFloat(currentPos.size || '0')
                        const tpPriceNum = parseFloat(tpPrice)
                        const tpAmount = currentPos.side === 'LONG'
                          ? (tpPriceNum - entryPrice) * sizeNum
                          : (entryPrice - tpPriceNum) * sizeNum
                        setEditTpAmount(tpAmount > 0 ? tpAmount.toFixed(2) : '')
                      } else {
                        setEditTpAmount('')
                      }
                      setEditDialogOpen(true)
                    }
                    return (
                      <BottomDockDesktopOpenPositionRow
                        key={pos.id}
                        pos={pos}
                        index={index}
                        rowExpanded={rowExpanded}
                        symbolMetaLookup={symbolMetaLookup}
                        posQuote={posQuote}
                        formatConv={formatConv}
                        formatSigned={formatSigned}
                        formatDateTimeSeconds={formatDateTimeSeconds}
                        formatMoney={formatMoney}
                        canClosePosition={canClosePosition}
                        onRowClick={openEditPositionPopup}
                        onToggleExpand={(e) => {
                          e.stopPropagation()
                          setExpandedPositionId((prev) => (prev === pos.id ? null : pos.id))
                        }}
                        onEditClick={(e) => {
                          e.stopPropagation()
                          openEditPositionPopup()
                        }}
                        onCloseClick={(e) => {
                          e.stopPropagation()
                          if (!canClosePosition) return
                          setClosePositionId(pos.id)
                          setClosePositionDialogOpen(true)
                        }}
                      />
                    )
                  })}
                </tbody>
              </table>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {tabForContent === 'orders' && (
          <>
            {ordersLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-8" variant="text" />
                    <Skeleton className="h-4 w-20" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                  </div>
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-slate-600 dark:text-muted">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No pending orders</div>
                  <div className="text-xs mt-1">Place an order to see it here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-slate-200 dark:border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Side</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Size</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Price</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Created</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter(o => {
                    const s = (o.status || '').trim().toLowerCase()
                    return s === 'pending' || s === 'cancelling'
                  }).map((order, index) => {
                    const timeStr = formatTime(order.created_at)
                    const statusNorm = (order.status || '').trim().toLowerCase()
                    const isPendingOrder = statusNorm === 'pending'
                    const isCancellingOrder = statusNorm === 'cancelling'
                    const orderSizeFmt = formatPositionSize(
                      parseFloat(order.size || '0'),
                      getSymbolMetaForCode(symbolMetaLookup, order.symbol),
                    )
                    
                    return (
                    <tr 
                      key={order.id} 
                      className={cn(
                        "border-b border-slate-200 dark:border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-text font-semibold">{order.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{order.symbol}</td>
                      <td className="px-4 py-3 text-text font-medium">{order.order_type}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                          order.side === 'BUY' 
                            ? 'bg-success/20 text-success' 
                            : 'bg-danger/20 text-danger'
                        )}>
                          {order.side}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-text font-medium"
                        title={orderSizeFmt.secondary || undefined}
                      >
                        {orderSizeFmt.display}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                          order.status === 'filled' 
                            ? 'bg-success/20 text-success' 
                            : isCancellingOrder
                            ? 'bg-warning/20 text-warning'
                            : order.status === 'pending' 
                            ? 'bg-info/20 text-info' 
                            : 'bg-slate-200/90 dark:bg-muted/20 text-slate-700 dark:text-muted'
                        )}>
                          {isCancellingOrder ? 'cancelling' : order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{timeStr}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {isPendingOrder && (
                            <>
                              <button
                                onClick={() => {
                                  if (!isPendingOrder) {
                                    toast.error('Order is already processed and cannot be edited')
                                    return
                                  }
                                  setEditItem({ type: 'order', id: order.id })
                                  setEditDialogOpen(true)
                                }}
                                className="p-2 hover:bg-accent/20 rounded-lg transition-all duration-200 text-accent hover:text-accent/80 hover:scale-110 active:scale-95"
                                title="Edit Order"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await cancelOrderApi(order.id)
                                    setOrders((prev) =>
                                      prev.map((o) =>
                                        o.id === order.id ? { ...o, status: 'cancelling' } : o
                                      )
                                    )
                                    toast.success(`Order ${order.id.slice(0, 8)}... cancel requested`)
                                    void fetchOrders(true)
                                  } catch (error: any) {
                                    toast.error(`Failed to cancel order: ${error.message}`)
                                  }
                                }}
                                className="p-2 hover:bg-danger/20 rounded-lg transition-all duration-200 text-danger hover:text-danger/80 hover:scale-110 active:scale-95"
                                title="Cancel Order"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            )}
          </>
        )}

        {tabForContent === 'order-history' && (
          <>
            {orderHistoryLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-8" variant="text" />
                    <Skeleton className="h-4 w-20" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                  </div>
                ))}
              </div>
            ) : filledOrders.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-slate-600 dark:text-muted">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No order history</div>
                  <div className="text-xs mt-1">Completed orders will appear here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-slate-200 dark:border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Side</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Size</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Filled</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Avg Price</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filledOrders.map((order, index) => {
                    const timeStr = formatDateTime(order.created_at)
                    const filledSize = parseFloat(order.filled_size || order.size || '0')
                    const avgPrice = parseFloat(order.average_price || order.price || '0')
                    const orderQuote = resolveQuoteCurrency(order.symbol, terminalSymbols)
                    const orderSizeFmt = formatPositionSize(
                      parseFloat(order.size || '0'),
                      getSymbolMetaForCode(symbolMetaLookup, order.symbol),
                    )
                    const filledSizeFmt = formatPositionSize(
                      filledSize,
                      getSymbolMetaForCode(symbolMetaLookup, order.symbol),
                    )

                    return (
                    <tr 
                      key={order.id} 
                      className={cn(
                        "border-b border-slate-200 dark:border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                        <td className="px-4 py-3 font-mono text-text font-semibold">{order.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{order.symbol}</td>
                        <td className="px-4 py-3 text-text font-medium uppercase">{order.order_type}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                            order.side === 'BUY' 
                            ? 'bg-success/20 text-success' 
                            : 'bg-danger/20 text-danger'
                        )}>
                            {order.side}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-text font-medium"
                        title={orderSizeFmt.secondary || undefined}
                      >
                        {orderSizeFmt.display}
                      </td>
                        <td
                          className="px-4 py-3 text-text font-medium"
                          title={filledSizeFmt.secondary || undefined}
                        >
                          {filledSizeFmt.display}
                        </td>
                        <td className="px-4 py-3 font-mono text-text">{avgPrice > 0 ? formatAmt(avgPrice, orderQuote) : '-'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-success/20 text-success font-bold text-[10px] uppercase tracking-wider">
                          {order.status}
                        </span>
                      </td>
                        <td className="px-4 py-3 text-text/70 text-[10px]">{timeStr}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {tabForContent === 'position-history' && (
          <>
            {closedPositionsLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-8" variant="text" />
                    <Skeleton className="h-4 w-20" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                    <Skeleton className="h-4 w-12" variant="text" />
                    <Skeleton className="h-4 w-16" variant="text" />
                  </div>
                ))}
              </div>
            ) : (() => {
              const historyRows = closedPositions
              return historyRows.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-slate-600 dark:text-muted">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No position history</div>
                  <div className="text-xs mt-1">Closed positions will appear here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-slate-200 dark:border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Quantity</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Direction</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Entry</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Exit</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest whitespace-nowrap">P&L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Status</th>
                      <th className="px-4 py-3 text-left text-[10px] text-slate-600/90 dark:text-muted/80 uppercase font-bold tracking-widest">Closed</th>
                  </tr>
                </thead>
                <tbody>
                    {historyRows.map((pos, index) => {
                      // Use original_size for closed/liquidated positions if available, otherwise use size
                      const sizeValue = (pos.status === 'CLOSED' || pos.status === 'LIQUIDATED') && pos.original_size
                        ? pos.original_size
                        : pos.size
                      const sizeNum = parseFloat(sizeValue || '0')
                      const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
                      // Handle both snake_case and camelCase for exit_price
                      const exitPriceValue = pos.exit_price || (pos as any).exitPrice || (pos as any).exit_price
                      const exitPrice = exitPriceValue && exitPriceValue !== 'null' && exitPriceValue !== '' 
                        ? parseFloat(String(exitPriceValue)) 
                        : null
                      const { market: marketPnl, net: netClosedPnl } = closedPositionPnlParts(pos)
                      const historyExpanded = expandedHistoryPositionId === pos.id
                      const closedAt = pos.updated_at ? formatDateTime(pos.updated_at) : '-'
                      const posQuote = resolveQuoteCurrency(pos.symbol, terminalSymbols)
                      const historySizeFmt = formatPositionSize(
                        sizeNum,
                        getSymbolMetaForCode(symbolMetaLookup, pos.symbol),
                      )

                      return (
                    <Fragment key={pos.id}>
                    <tr 
                      className={cn(
                        "border-b border-slate-200 dark:border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                          <td className="px-4 py-3 font-mono text-text font-semibold">{pos.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{pos.symbol}</td>
                          <td
                            className="px-4 py-3 text-text font-medium"
                            title={historySizeFmt.secondary || undefined}
                          >
                            {historySizeFmt.display}
                          </td>
                      <td className="px-4 py-3">
                            <span className={cn(
                              "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                              pos.side === 'LONG' 
                                ? 'bg-success/20 text-success' 
                                : 'bg-danger/20 text-danger'
                            )}>
                              {pos.side}
                        </span>
                      </td>
                          <td className="px-4 py-3 font-mono text-text font-medium">{formatConv(entryPrice, posQuote)}</td>
                          <td className="px-4 py-3 font-mono text-text font-medium">
                            {exitPrice !== null ? formatConv(exitPrice, posQuote) : '-'}
                          </td>
                          <td className={cn(
                            "px-4 py-3 font-mono font-bold whitespace-nowrap tabular-nums",
                            netClosedPnl >= 0 ? "text-success" : "text-danger"
                          )}>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedHistoryPositionId((prev) => (prev === pos.id ? null : pos.id))
                                }
                                className="p-1 rounded hover:bg-surface-2 text-slate-600 dark:text-muted shrink-0"
                                title={historyExpanded ? 'Hide P&L breakdown' : 'Show P&L breakdown'}
                                aria-expanded={historyExpanded}
                              >
                                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', historyExpanded && 'rotate-180')} />
                              </button>
                              <span>{formatSigned(netClosedPnl)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                              pos.status === 'LIQUIDATED' ? 'bg-danger/20 text-danger' : 'bg-slate-200 dark:bg-white/10 text-text/80'
                            )}>
                              {pos.status === 'LIQUIDATED' ? 'Liquidated' : 'Closed'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text/70 text-[10px]">{closedAt}</td>
                    </tr>
                    {historyExpanded ? (
                      <tr className={cn(index % 2 === 0 ? 'bg-surface/30' : 'bg-surface/50', 'border-b border-slate-200 dark:border-white/5')}>
                        <td colSpan={9} className="px-4 py-3 bg-surface-2/40">
                          <div className="max-w-md">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-muted mb-2">
                              P&L breakdown
                            </div>
                            <PositionPnLBreakdown
                              marketPnlUsd={marketPnl}
                              accumulatedSwapUsd={pos.accumulatedSwapUsd}
                              accumulatedFeesUsd={pos.accumulatedFeesUsd}
                              netPnlUsd={netClosedPnl}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                      )
                    })}
                </tbody>
              </table>
              )
            })()}
          </>
        )}

      </div>

      {/* Bottom Stats Bar - hidden on mobile when fullHeight (Positions tab) to match reference */}
      <div className={cn('shrink-0 h-14 border-t border-slate-200 dark:border-white/5 bg-surface-2 items-center px-4 text-sm overflow-x-auto scrollbar-thin scrollbar-hide', fullHeight ? 'hidden md:flex' : 'flex')}>
        <div className="flex items-center gap-4 min-w-max">
          {([
            {
              formula:
                'Balance reflects deposits, withdrawals, closed position P&L, fees paid (at order placement), and swap settlements (when positions close).',
              icon: Wallet,
              label: 'Balance ',
              value: accountSummary != null ? formatMoney(accountSummary.balance) : '—',
              valueClass: 'text-text',
            },
            {
              formula:
                'Equity = Balance + Bonus + Unrealized P&L\n\nBalance reflects deposits, withdrawals, closed position P&L, fees paid, and swap settlements.\nUnrealized P&L is net of accrued swap (and fees already taken at placement) on open positions.',
              icon: TrendingUp,
              label: 'Equity ',
              value: accountSummary != null ? formatMoney(accountSummary.equity) : '—',
              valueClass: 'text-text',
            },
            { formula: 'Margin = Sum of margin used by all open positions', icon: Shield, label: 'Margin ', value: accountSummary != null ? formatMoney(accountSummary.marginLevel === 'inf' ? 0 : accountSummary.marginUsed) : '—', valueClass: 'text-text' },
            {
              formula: 'Free Margin = Equity − Margin Used\nAvailable to open new positions.',
              icon: DollarSign,
              label: 'Free Margin ',
              value: accountSummary != null ? formatMoney(accountSummary.freeMargin) : '—',
              valueClass: 'text-text',
            },
            { formula: 'Bonus = Non-withdrawable promotional trading credit', icon: Gift, label: 'Bonus ', value: accountSummary != null ? formatMoney(accountSummary.bonus ?? 0) : '—', valueClass: 'text-text' },
            { formula: 'Margin Level = (Equity ÷ Margin) × 100% (∞ when Margin = 0)', icon: Gauge, label: 'Margin Level ', value: accountSummary != null ? (accountSummary.marginLevel === 'inf' ? '∞' : `${accountSummary.marginLevel}%`) : '—', valueClass: 'font-semibold text-accent' },
            { formula: 'RI PNL (Realized PnL) = Profit/Loss from closed positions', icon: ArrowUpRight, label: 'RI PNL ', value: accountSummary != null ? formatSigned(accountSummary.realizedPnl) : '—', valueClass: cn(accountSummary != null && accountSummary.realizedPnl < 0 ? 'text-danger' : 'text-success') },
            {
              formula:
                'Unrealized P&L (net) = sum of net P&L on open positions (market move minus accrued swap; fees already reflected in balance).',
              icon: ArrowDownRight,
              label: 'UnR Net PNL ',
              value: accountSummary != null ? formatSigned(accountSummary.unrealizedPnl) : '—',
              valueClass: cn(accountSummary != null && accountSummary.unrealizedPnl < 0 ? 'text-danger' : 'text-success'),
            },
          ] as const).map(({ formula, icon: Icon, label, value, valueClass }, i) => (
            <span key={i} className="contents">
              {i > 0 ? <div className="h-4 w-px bg-border shrink-0" /> : null}
              <div
                className="relative flex items-center gap-1.5 shrink-0 cursor-help"
                onMouseEnter={(e) => setFormulaTooltip({ formula, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setFormulaTooltip(null)}
              >
                <Icon className="h-4 w-4 text-slate-600 dark:text-muted" />
                <span className="text-slate-600 dark:text-muted">{label}</span>
                <span className={valueClass}>{value}</span>
              </div>
            </span>
          ))}
        </div>
      </div>
      {formulaTooltip &&
        createPortal(
          <div
            className="fixed z-[9999] px-2.5 py-2 text-xs font-medium text-text bg-surface border border-border rounded shadow-lg max-w-xs text-left whitespace-pre-line pointer-events-none"
            style={{
              left: formulaTooltip.rect.left + formulaTooltip.rect.width / 2,
              bottom: window.innerHeight - formulaTooltip.rect.top + 6,
              transform: 'translateX(-50%)',
            }}
          >
            {formulaTooltip.formula}
          </div>,
          document.body
        )}

      {/* Positions 3-dot menu: Close All + Close only profitable (mobile) */}
      {positionsOptionsMenuOpen &&
        createPortal(
          <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
            <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/50" onClick={() => setPositionsOptionsMenuOpen(false)} aria-hidden />
            <div className="relative rounded-t-xl border-t border-slate-300 dark:border-white/10 bg-surface shadow-xl safe-area-pb">
              <div className="divide-y divide-slate-200 dark:divide-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setPositionsOptionsMenuOpen(false)
                    setCloseAllDialogOpen(true)
                  }}
                  disabled={!canClosePosition || positions.filter((p) => p.status === 'OPEN').length === 0}
                  className="w-full py-4 px-4 text-left text-sm font-medium text-text hover:bg-slate-100 dark:hover:bg-white/5 active:bg-slate-200 dark:active:bg-white/10 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-3"
                >
                  <XCircle className="h-5 w-5 text-danger shrink-0" />
                  Close All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPositionsOptionsMenuOpen(false)
                    setCloseProfitableOnlyDialogOpen(true)
                  }}
                  disabled={
                    !canClosePosition ||
                    sortedOpenPositions.length === 0 ||
                    !dockHasProfitableLive
                  }
                  className="w-full py-4 px-4 text-left text-sm font-medium text-text hover:bg-slate-100 dark:hover:bg-white/5 active:bg-slate-200 dark:active:bg-white/10 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-3"
                >
                  <TrendingUp className="h-5 w-5 text-success shrink-0" />
                  Close only profitable positions
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Close All Positions Dialog */}
      <Dialog.Root open={closeAllDialogOpen} onOpenChange={(open) => !closeAllLoading && setCloseAllDialogOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 dark:bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close All Positions
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-600 dark:text-muted mb-6">
              Are you sure you want to close all {positions.filter(p => p.status === 'OPEN').length} open position(s)? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setCloseAllDialogOpen(false)}
                disabled={closeAllLoading}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const openPositions = positions.filter(p => p.status === 'OPEN')
                  if (openPositions.length === 0) {
                    setCloseAllDialogOpen(false)
                    return
                  }
                  setCloseAllLoading(true)
                  let closed = 0
                  const failedPositions: { id: string; symbol: string; error: string }[] = []
                  try {
                    for (const pos of openPositions) {
                      try {
                        const pk = canonicalPositionId(pos.id)
                        flushSync(() => {
                          positionCloseTombstonesRef.current.set(pk, Date.now())
                          setPositions((prev) => prev.filter((p) => canonicalPositionId(p.id) !== pk))
                        })
                        await closePosition(pos.id)
                        closed++
                      } catch (err: unknown) {
                        positionCloseTombstonesRef.current.delete(canonicalPositionId(pos.id))
                        void fetchOpenPositions(true)
                        failedPositions.push({ id: pos.id, symbol: pos.symbol, error: closePositionErrorMessage(err) })
                      }
                    }
                    if (closed > 0) {
                      toast.success(closed === openPositions.length
                        ? `All ${closed} position(s) closed successfully`
                        : `Closed ${closed} position(s)${failedPositions.length > 0 ? `, ${failedPositions.length} failed` : ''}`)
                    }
                    if (failedPositions.length > 0) {
                      const detail = failedPositions.length === 1
                        ? `${failedPositions[0].symbol}: ${failedPositions[0].error}`
                        : `${failedPositions.length} position(s) failed to close`
                      toast.error(closed === 0 ? detail : detail)
                    }
                    setCloseAllDialogOpen(false)
                    fetchOpenPositions(true)
                  } finally {
                    setCloseAllLoading(false)
                  }
                }}
                disabled={closeAllLoading}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors disabled:opacity-50"
              >
                {closeAllLoading ? 'Closing...' : 'Close All'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Close only profitable positions Dialog */}
      <Dialog.Root
        open={closeProfitableOnlyDialogOpen}
        onOpenChange={(open) => !closeProfitableOnlyLoading && setCloseProfitableOnlyDialogOpen(open)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 dark:bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <BottomDockCloseProfitableOnlyDialogBody
              openPositions={sortedOpenPositions}
              closeProfitableOnlyLoading={closeProfitableOnlyLoading}
              setCloseProfitableOnlyLoading={setCloseProfitableOnlyLoading}
              onCloseDialog={() => setCloseProfitableOnlyDialogOpen(false)}
              positionCloseTombstonesRef={positionCloseTombstonesRef}
              setPositions={setPositions}
              fetchOpenPositions={fetchOpenPositions}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Close Position Dialog */}
      <Dialog.Root open={closePositionDialogOpen} onOpenChange={setClosePositionDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 dark:bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close Position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-600 dark:text-muted mb-6">
              Are you sure you want to close position {closePositionId?.slice(0, 8)}…?
              {closeDialogSizeFmt ? (
                <>
                  {' '}
                  Size:{' '}
                  <span className="font-mono font-medium text-text" title={closeDialogSizeFmt.secondary || undefined}>
                    {closeDialogSizeFmt.display}
                  </span>
                  {closeDialogSizeFmt.secondary ? (
                    <span className="block text-xs mt-1 text-text-muted">Raw: {closeDialogSizeFmt.secondary}</span>
                  ) : null}
                </>
              ) : null}
              <span className="block mt-2">This action cannot be undone.</span>
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setClosePositionDialogOpen(false)}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!closePositionId) return
                  const idToClose = closePositionId
                  const idKey = canonicalPositionId(idToClose)
                  flushSync(() => {
                    positionCloseTombstonesRef.current.set(idKey, Date.now())
                    setPositions((prev) => prev.filter((p) => canonicalPositionId(p.id) !== idKey))
                  })
                  setClosePositionDialogOpen(false)
                  setClosePositionId(null)
                  try {
                    await closePosition(idToClose)
                    toast.success(`Position ${idToClose.slice(0, 8)}... closed successfully`)
                    setTimeout(() => void fetchOpenPositions(true), 500)
                    setTimeout(() => void fetchOpenPositions(true), 1200)
                  } catch (error: unknown) {
                    positionCloseTombstonesRef.current.delete(idKey)
                    void fetchOpenPositions(true)
                    toast.error(closePositionErrorMessage(error))
                  }
                }}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors"
              >
                Close Position
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Cancel Order Dialog */}
      <Dialog.Root open={cancelOrderDialogOpen} onOpenChange={setCancelOrderDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 dark:bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Cancel Order
            </Dialog.Title>
            <Dialog.Description className="text-sm text-slate-600 dark:text-muted mb-6">
              Are you sure you want to cancel order {cancelOrderId}? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setCancelOrderDialogOpen(false)}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toast.success(`Order ${cancelOrderId} cancelled successfully`)
                  setCancelOrderDialogOpen(false)
                  setCancelOrderId(null)
                }}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors"
              >
                Cancel Order
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Edit Dialog */}
      <Dialog.Root open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-900/40 dark:bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold text-text">
              <span>
                Edit {editItem?.type === 'position' ? 'Position' : 'Order'}
              </span>
              {editItem?.id ? (
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      editItem.id,
                      editItem.type === 'position' ? 'Position ID' : 'Order ID'
                    )
                  }
                  className="max-w-full truncate font-mono text-sm font-normal text-accent hover:underline"
                  title="Click to copy ID"
                >
                  {editItem.id}
                </button>
              ) : null}
            </Dialog.Title>
            <div className="space-y-4 mb-6">
              {editItem?.type === 'position' && editingPosition ? (
                <>
                  {/* Stop Loss Section */}
                  <div className="space-y-2">
                    <label className="text-xs text-slate-600 dark:text-muted mb-1 block font-semibold">Stop Loss</label>
                    <div className="grid grid-cols-2 gap-2">
                  <div>
                        <label className="text-[10px] text-slate-600 dark:text-muted mb-1 block">
                          Price ({resolveQuoteCurrency(editingPosition.symbol, terminalSymbols)})
                        </label>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="SL Price" 
                          className="w-full"
                          value={editSl}
                          onChange={(e) => {
                            const price = e.target.value
                            setEditSl(price)
                            // Calculate dollar amount from price
                            if (price && editingPosition) {
                              const entryPrice = parseFloat(editingPosition.avg_price || editingPosition.entry_price || '0')
                              const sizeNum = parseFloat(editingPosition.size || '0')
                              const slPriceNum = parseFloat(price)
                              if (!isNaN(slPriceNum) && sizeNum > 0) {
                                const slAmount = editingPosition.side === 'LONG' 
                                  ? (entryPrice - slPriceNum) * sizeNum
                                  : (slPriceNum - entryPrice) * sizeNum
                                setEditSlAmount(slAmount > 0 ? slAmount.toFixed(2) : '')
                              } else {
                                setEditSlAmount('')
                              }
                            } else {
                              setEditSlAmount('')
                            }
                          }}
                        />
                  </div>
                  <div>
                        <label className="text-[10px] text-slate-600 dark:text-muted mb-1 block">
                          Amount ({resolveQuoteCurrency(editingPosition.symbol, terminalSymbols)} notional)
                        </label>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="Loss Amount" 
                          className="w-full"
                          value={editSlAmount}
                          onChange={(e) => {
                            const amount = e.target.value
                            setEditSlAmount(amount)
                            // Calculate price from dollar amount
                            if (amount && editingPosition) {
                              const entryPrice = parseFloat(editingPosition.avg_price || editingPosition.entry_price || '0')
                              const sizeNum = parseFloat(editingPosition.size || '0')
                              const lossAmount = parseFloat(amount)
                              if (!isNaN(lossAmount) && sizeNum > 0) {
                                const slPrice = editingPosition.side === 'LONG'
                                  ? entryPrice - (lossAmount / sizeNum)
                                  : entryPrice + (lossAmount / sizeNum)
                                setEditSl(slPrice > 0 ? slPrice.toFixed(2) : '')
                              } else {
                                setEditSl('')
                              }
                            } else {
                              setEditSl('')
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Take Profit Section */}
                  <div className="space-y-2">
                    <label className="text-xs text-slate-600 dark:text-muted mb-1 block font-semibold">Take Profit</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-600 dark:text-muted mb-1 block">
                          Price ({resolveQuoteCurrency(editingPosition.symbol, terminalSymbols)})
                        </label>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="TP Price" 
                          className="w-full"
                          value={editTp}
                          onChange={(e) => {
                            const price = e.target.value
                            setEditTp(price)
                            // Calculate dollar amount from price
                            if (price && editingPosition) {
                              const entryPrice = parseFloat(editingPosition.avg_price || editingPosition.entry_price || '0')
                              const sizeNum = parseFloat(editingPosition.size || '0')
                              const tpPriceNum = parseFloat(price)
                              if (!isNaN(tpPriceNum) && sizeNum > 0) {
                                const tpAmount = editingPosition.side === 'LONG'
                                  ? (tpPriceNum - entryPrice) * sizeNum
                                  : (entryPrice - tpPriceNum) * sizeNum
                                setEditTpAmount(tpAmount > 0 ? tpAmount.toFixed(2) : '')
                              } else {
                                setEditTpAmount('')
                              }
                            } else {
                              setEditTpAmount('')
                            }
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-600 dark:text-muted mb-1 block">
                          Amount ({resolveQuoteCurrency(editingPosition.symbol, terminalSymbols)} notional)
                        </label>
                        <Input 
                          type="number" 
                          step="0.01" 
                          placeholder="Profit Amount" 
                          className="w-full"
                          value={editTpAmount}
                          onChange={(e) => {
                            const amount = e.target.value
                            setEditTpAmount(amount)
                            // Calculate price from dollar amount
                            if (amount && editingPosition) {
                              const entryPrice = parseFloat(editingPosition.avg_price || editingPosition.entry_price || '0')
                              const sizeNum = parseFloat(editingPosition.size || '0')
                              const profitAmount = parseFloat(amount)
                              if (!isNaN(profitAmount) && sizeNum > 0) {
                                const tpPrice = editingPosition.side === 'LONG'
                                  ? entryPrice + (profitAmount / sizeNum)
                                  : entryPrice - (profitAmount / sizeNum)
                                setEditTp(tpPrice > 0 ? tpPrice.toFixed(2) : '')
                              } else {
                                setEditTp('')
                              }
                            } else {
                              setEditTp('')
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-slate-600 dark:text-muted mb-1 block">Price</label>
                    <Input type="number" step="0.01" placeholder="Enter price" className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 dark:text-muted mb-1 block">Size</label>
                    <Input type="number" step="0.000001" placeholder="Enter size" className="w-full" />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setEditDialogOpen(false)
                  setEditItem(null)
                  setEditSl('')
                  setEditTp('')
                  setEditSlAmount('')
                  setEditTpAmount('')
                  setEditingPosition(null)
                }}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (editItem?.type === 'position' && editItem.id) {
                    try {
                      const slValue = editSl ? String(editSl).trim() : ''
                      const tpValue = editTp ? String(editTp).trim() : ''
                      await updatePositionSltp(editItem.id, {
                        stop_loss: slValue || null,
                        take_profit: tpValue || null,
                      })
                      toast.success(`Position SL/TP updated successfully`)
                      setEditDialogOpen(false)
                      setEditItem(null)
                      setEditSl('')
                      setEditTp('')
                      setEditSlAmount('')
                      setEditTpAmount('')
                      setEditingPosition(null)
                      fetchOpenPositions(true)
                    } catch (error: any) {
                      toast.error(`Failed to update position: ${error.message}`)
                    }
                  } else if (editItem?.type === 'order' && editItem.id) {
                    const targetOrder = orders.find((o) => o.id === editItem.id)
                    const currentStatus = (targetOrder?.status || '').trim().toLowerCase()
                    if (currentStatus && currentStatus !== 'pending') {
                      toast.error(`Order is already ${currentStatus} and cannot be edited`)
                    } else {
                      toast.error('Order editing is not available for executed/terminal order states')
                    }
                    setEditDialogOpen(false)
                    setEditItem(null)
                    setEditSl('')
                    setEditTp('')
                    setEditSlAmount('')
                    setEditTpAmount('')
                    setEditingPosition(null)
                  }
                }}
                className="px-4 py-2 text-sm bg-accent text-white hover:bg-accent/90 rounded transition-colors"
              >
                Save Changes
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {sortedOpenPositions.length > 0 ? (
        <BottomDockLiveProfitablePresence
          positions={sortedOpenPositions}
          onHasProfitableChange={setDockHasProfitableLive}
        />
      ) : null}
    </div>
  )
}

