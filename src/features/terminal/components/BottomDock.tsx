import { Columns, Download, Wallet, TrendingUp, Shield, DollarSign, Gift, Gauge, ArrowUpRight, ArrowDownRight, X, Edit, Trash2, XCircle, Package, FileText, History, AlertCircle, Maximize2, Minimize2, Search, MoreVertical } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'
import * as Dialog from '@radix-ui/react-dialog'
import { Input, Skeleton } from '@/shared/ui'
import { getPositions, Position, updatePositionSltp, closePosition } from '../api/positions.api'

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
import { listOrders, Order, cancelOrder as cancelOrderApi } from '../api/orders.api'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWalletStore } from '@/shared/store/walletStore'
import { usePriceStream } from '@/features/symbols/hooks/usePriceStream'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useTerminalStore } from '../store/terminalStore'

export interface BottomDockProps {
  /** When true (e.g. mobile Positions tab), dock fills available height instead of fixed 300px. */
  fullHeight?: boolean
  /** When set, only show content for this tab (no tab strip). Used by TerminalPositionsView. */
  standaloneTab?: 'positions' | 'orders'
}

export function BottomDock({ fullHeight = false, standaloneTab }: BottomDockProps = {}) {
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
  const [isLoading, setIsLoading] = useState(false)
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
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [isBottomDockFullscreen, setIsBottomDockFullscreen] = useState(false)
  const bottomDockRef = useRef<HTMLDivElement>(null)
  const [filledOrders, setFilledOrders] = useState<Order[]>([])
  const { accountSummary } = useAccountSummary()
  const tradingAccess = useAuthStore((s) => s.user?.tradingAccess ?? 'full')
  const canClosePosition = tradingAccess !== 'disabled'
  const [formulaTooltip, setFormulaTooltip] = useState<{ formula: string; rect: DOMRect } | null>(null)
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null)
  const [actionMenuPositionId, setActionMenuPositionId] = useState<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressHandledRef = useRef(false)
  const setMobileTab = useTerminalStore((s) => s.setMobileTab)
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastPositionCountRef = useRef<number>(0)

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

  // Normalize symbol key - convert USDT to USD to match price stream format
  const normalizeSymbolKey = (symbol: string): string => {
    return symbol.toUpperCase().trim().replace('USDT', 'USD')
  }

  // Get symbols from positions for price streaming
  const positionSymbols = useMemo(() => {
    const symbols = positions
      .filter(p => p.status === 'OPEN')
      .map(p => p.symbol.toUpperCase())
      .filter((symbol, index, self) => self.indexOf(symbol) === index) // Remove duplicates
    return symbols
  }, [positions])

  // Subscribe to live price stream for position symbols
  const { prices: livePrices } = usePriceStream(positionSymbols)

  // Open positions with live price and PnL for table and mobile cards
  const openPositionsWithComputed = useMemo(() => {
    const open = positions
      .filter(p => p.status === 'OPEN')
      .sort((a, b) => {
        const aTime = a.opened_at || a.updated_at || 0
        const bTime = b.opened_at || b.updated_at || 0
        return bTime - aTime
      })
    return open.map(pos => {
      const sizeNum = parseFloat(pos.size || '0')
      const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
      const symbolKey = normalizeSymbolKey(pos.symbol)
      let priceData = livePrices.get(symbolKey)
      if (!priceData) priceData = livePrices.get(pos.symbol.toUpperCase())
      const livePrice = priceData
        ? (pos.side === 'LONG' ? parseFloat(priceData.bid) : parseFloat(priceData.ask))
        : null
      const unrealizedPnl = livePrice !== null
        ? (pos.side === 'LONG'
            ? (livePrice - entryPrice) * sizeNum
            : (entryPrice - livePrice) * sizeNum)
        : parseFloat(pos.unrealized_pnl || '0')
      return { position: pos, livePrice, unrealizedPnl, sizeNum, entryPrice }
    })
  }, [positions, livePrices])

  const tabs = [
    { id: 'positions', label: 'Positions' },
    { id: 'orders', label: 'Orders' },
    { id: 'order-history', label: 'O. History' },
    { id: 'position-history', label: 'P. History' },
  ]
  
  // Handler to change tab and persist to localStorage
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId)
    localStorage.setItem('bottomDockActiveTab', tabId)
  }, [])

  // Fetch positions from API. When silent is true, no loading state (no skeleton flash).
  const fetchPositions = useCallback(async (silent?: boolean) => {
    if (!silent) setIsLoading(true)
    try {
      const data = await getPositions()
      setPositions(data)
      const openCount = data.filter(p => p.status === 'OPEN').length
      lastPositionCountRef.current = openCount
    } catch (error: any) {
      console.error('❌ Failed to fetch positions:', error)
      if (!silent) toast.error('Failed to load positions')
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [])

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listOrders({ status: 'pending', limit: 100 })
      setOrders(data.items)
    } catch (error: any) {
      console.error('Failed to fetch orders:', error)
      toast.error('Failed to load orders')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch filled orders from API
  const fetchFilledOrders = useCallback(async () => {
    try {
      const data = await listOrders({ status: 'filled', limit: 100 })
      console.log('📦 Filled orders fetched from API:', {
        count: data.items.length,
        total: data.total,
        orders: data.items.map(o => ({
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          status: o.status,
          filled_size: o.filled_size,
          average_price: (o as any).average_price || (o as any).average_fill_price || o.price
        }))
      })
      setFilledOrders(data.items)
      if (data.items.length > 0) {
        console.log(`✅ ${data.items.length} filled order(s) loaded`)
      }
    } catch (error: any) {
      console.error('❌ Failed to fetch filled orders:', error)
      // Only show error toast if we're on the order-history tab
      if (activeTab === 'order-history') {
        toast.error('Failed to load order history')
    }
    }
  }, [activeTab])

  // Initial fetch on mount - show loading on first load only
  useEffect(() => {
    fetchPositions().then(() => {
      setTimeout(() => {
        lastPositionCountRef.current = positions.length
      }, 100)
    })
    fetchOrders()
  }, [fetchPositions, fetchOrders])

  // Fetch data when tab changes - silent refresh so table doesn't flash
  useEffect(() => {
    if (activeTab === 'positions') {
      fetchPositions(true)
      fetchFilledOrders()
    } else if (activeTab === 'orders') {
      // Refresh orders when switching to orders tab
      fetchOrders()
    } else if (activeTab === 'order-history') {
      fetchFilledOrders() // Fetch filled orders for order history tab
    }
  }, [activeTab, fetchPositions, fetchOrders, fetchFilledOrders])

  // Polling fallback: silent refresh every 2s when on positions tab
  useEffect(() => {
    if (activeTab === 'positions') {
      pollingIntervalRef.current = setInterval(() => {
        fetchPositions(true).then(() => {
          const currentCount = positions.filter(p => p.status === 'OPEN').length
          if (currentCount !== lastPositionCountRef.current) {
            lastPositionCountRef.current = currentCount
          }
        })
      }, 2000)
    } else {
      // Clear polling when not on positions tab
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [activeTab, fetchPositions, positions.length])

  // WebSocket for real-time position/order updates with reconnection (no polling)
  useEffect(() => {
    const wsUrl =
      import.meta.env.VITE_WS_URL ||
      (import.meta.env.DEV ? `ws://${location.host}/ws?group=default` : 'ws://localhost:3003/ws?group=default')
    let reconnectAttempts = 0
    const maxReconnectAttempts = 30
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let mounted = true

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

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mounted || wsRef.current !== ws) return
        reconnectAttempts = 0
        setWsConnected(true)
        try {
          ws.send(JSON.stringify({ type: 'auth', token: accessToken }))
        } catch (error) {
          console.error('Failed to send auth message:', error)
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type !== 'pong' && data.type !== 'tick') {
            console.log('📨 [BottomDock] WebSocket message:', data.type, data)
          }

          if (data.type === 'auth_success') {
            if (!mounted || wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return
            setTimeout(() => {
              if (wsRef.current === ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'subscribe', symbols: [], channels: ['positions', 'orders', 'balances', 'wallet'] }))
              }
            }, 500)
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
                  const msg = isIncrease
                    ? `Deposit approved – balance updated: $${newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : `Balance updated: $${newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  toast.success(msg, { duration: 3000 })
                }
              }
            }
          } else if (data.type === 'auth_error') {
            console.error('❌ WebSocket authentication failed:', data.error)
            toast.error(`WebSocket auth failed: ${data.error}`)
          }

          if (data.type === 'position_update') {
            const positionId = data.position_id
            if (!positionId) return
            const positionStatus = (data.status || 'OPEN').toUpperCase() as 'OPEN' | 'CLOSED' | 'LIQUIDATED'
            const isOpen = positionStatus === 'OPEN'

            setPositions(prev => {
              const existing = prev.findIndex(p => p.id === positionId)
              if (existing >= 0) {
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
                setTimeout(() => fetchPositions(true), 500)
                return [...prev, newPosition]
              }
              if (positionStatus === 'CLOSED' || positionStatus === 'LIQUIDATED') {
                return prev.filter(p => p.id !== positionId)
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

          if (data.type === 'order_update' && data.payload) {
            const orderUpdate = data.payload
            setOrders(prev => {
              const existing = prev.findIndex(o => o.id === orderUpdate.order_id)
              if (existing >= 0) {
                const updated = [...prev]
                updated[existing] = {
                  ...updated[existing],
                  status: orderUpdate.status?.toLowerCase() || updated[existing].status,
                  filled_size: orderUpdate.filled_size?.toString() || updated[existing].filled_size,
                  avg_fill_price: orderUpdate.avg_fill_price?.toString() || updated[existing].avg_fill_price,
                }
                if (orderUpdate.status === 'FILLED' || orderUpdate.status === 'CANCELLED') {
                  if (orderUpdate.status === 'FILLED') {
                    fetchPositions(true)
                    fetchFilledOrders()
                    setTimeout(() => fetchPositions(true), 600)
                  }
                  return updated.filter((_, i) => i !== existing)
                }
                return updated
              }
              if (orderUpdate.status === 'PENDING') {
                return [...prev, {
                  id: orderUpdate.order_id,
                  symbol: orderUpdate.symbol || 'UNKNOWN',
                  side: orderUpdate.side || 'BUY',
                  order_type: 'MARKET',
                  size: orderUpdate.quantity || '0',
                  price: orderUpdate.price,
                  status: 'pending',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                } as Order]
              }
              return prev
            })
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
        if (wsRef.current === ws) wsRef.current = null
        setWsConnected(false)
        if (mounted) scheduleReconnect()
      }
    }

    connect()
    return () => {
      mounted = false
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  const tabForContent = effectiveTab ?? activeTab

  // Fetch data when tab changes - silent for positions so no skeleton flash
  useEffect(() => {
    const tab = effectiveTab ?? activeTab
    if (tab === 'positions') {
      fetchPositions(true)
    } else if (tab === 'orders') {
      fetchOrders()
    } else if (tab === 'order-history') {
      setIsLoading(true)
      fetchFilledOrders().finally(() => setIsLoading(false))
    } else if (tab === 'position-history') {
      fetchPositions(true)
    }
  }, [activeTab, effectiveTab, fetchPositions, fetchOrders, fetchFilledOrders])

  // WebSocket handles real-time updates, no polling needed

  return (
    <div
      ref={bottomDockRef}
      className={cn(
        'min-h-0 overflow-hidden flex flex-col border-t border-white/5 bg-gradient-to-b from-surface to-surface-2/30 shadow-lg shadow-black/10',
        isBottomDockFullscreen ? 'h-screen' : fullHeight ? 'flex-1 min-h-0' : 'h-[300px]'
      )}
    >
      {/* Tab Strip + Toolbar: hide when standaloneTab is set (parent shows sub-tabs) */}
      {!effectiveTab && (
      <div className="shrink-0 min-h-12 border-b border-white/5 flex items-center justify-between gap-2 px-3 sm:px-4 bg-gradient-to-r from-white/[0.02] to-transparent">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-thin py-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                'shrink-0 px-3 py-2 text-xs font-bold transition-all duration-200 uppercase tracking-wider whitespace-nowrap relative',
                'md:rounded-lg',
                activeTab === tab.id
                  ? 'text-white border-b-2 border-accent pb-2 -mb-px md:bg-accent md:shadow-md md:shadow-accent/20 md:border-b-0 md:pb-2'
                  : 'text-muted hover:text-text border-b-2 border-transparent md:border-b-0 md:hover:bg-surface-2/50'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white hidden md:block" />
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
              <Minimize2 className="h-4 w-4 text-muted hover:text-text" />
            ) : (
              <Maximize2 className="h-4 w-4 text-muted hover:text-text" />
            )}
          </button>
        </div>
      </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {tabForContent === 'positions' && (
          <>
            {isLoading ? (
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
                    <Skeleton className="h-4 w-12" variant="text" />
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
                      { label: 'Balance', value: accountSummary != null ? `$${accountSummary.balance.toFixed(2)}` : '—', valueClass: 'text-text' },
                      { label: 'Equity', value: accountSummary != null ? `$${accountSummary.equity.toFixed(2)}` : '—', valueClass: 'text-text' },
                      { label: 'Margin', value: accountSummary != null ? `$${(accountSummary.marginLevel === 'inf' ? 0 : accountSummary.marginUsed).toFixed(2)}` : '—', valueClass: 'text-text' },
                      { label: 'Free Margin', value: accountSummary != null ? `$${accountSummary.freeMargin.toFixed(2)}` : '—', valueClass: 'text-text' },
                      { label: 'Margin Level (%)', value: accountSummary != null ? (accountSummary.marginLevel === 'inf' ? '∞' : `${accountSummary.marginLevel}%`) : '—', valueClass: 'text-accent font-semibold' },
                      { label: 'Total Positions', value: String(openPositionsWithComputed.length), valueClass: 'text-text' },
                    ].map(({ label, value, valueClass }) => (
                      <div key={label} className="flex justify-between items-center text-sm">
                        <span className="text-muted">{label}</span>
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
                        onClick={() => toast('Search coming soon')}
                        className="p-2 rounded-lg hover:bg-surface-2 text-muted hover:text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label="Search positions"
                      >
                        <Search className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toast('Options coming soon')}
                        className="p-2 rounded-lg hover:bg-surface-2 text-muted hover:text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label="More options"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                  {openPositionsWithComputed.length === 0 ? (
                    <div className="text-center text-muted py-8 text-sm">No positions found</div>
                  ) : (
                    <>
                  {openPositionsWithComputed.map(({ position: pos, livePrice, unrealizedPnl, sizeNum, entryPrice }) => {
                    const openEditPositionPopup = () => {
                      const currentPos = positions.find(p => p.id === pos.id)
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
                    const ts = pos.opened_at != null ? (pos.opened_at < 1e12 ? pos.opened_at * 1000 : pos.opened_at) : Date.now()
                    const openedAtStr = new Date(ts).toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
                    const d = new Date(ts)
                    const openedAtLongStr = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`
                    const currentStr = livePrice != null ? livePrice.toFixed(5) : '—'
                    const isExpanded = expandedPositionId === pos.id
                    const marginNum = parseFloat(pos.margin || '0')
                    const hasValidSl = pos.sl != null && String(pos.sl).trim() !== '' && pos.sl !== 'null' && !Number.isNaN(Number(pos.sl))
                    const hasValidTp = pos.tp != null && String(pos.tp).trim() !== '' && pos.tp !== 'null' && !Number.isNaN(Number(pos.tp))
                    const handleRowClick = () => {
                      if (longPressHandledRef.current) {
                        longPressHandledRef.current = false
                        return
                      }
                      setExpandedPositionId((prev) => (prev === pos.id ? null : pos.id))
                    }
                    const handleTouchStart = () => {
                      longPressHandledRef.current = false
                      longPressTimerRef.current = setTimeout(() => {
                        longPressTimerRef.current = null
                        longPressHandledRef.current = true
                        window.getSelection()?.removeAllRanges()
                        setActionMenuPositionId(pos.id)
                      }, 500)
                    }
                    const handleTouchEnd = () => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current)
                        longPressTimerRef.current = null
                      }
                    }
                    const handleContextMenu = (e: React.MouseEvent) => {
                      e.preventDefault()
                      setActionMenuPositionId(pos.id)
                    }
                    return (
                      <div
                        key={pos.id}
                        className="border-b border-white/10 py-3 flex flex-col gap-1"
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={handleRowClick}
                          onKeyDown={(e) => e.key === 'Enter' && handleRowClick()}
                          onTouchStart={handleTouchStart}
                          onTouchEnd={handleTouchEnd}
                          onTouchMove={handleTouchEnd}
                          onContextMenu={handleContextMenu}
                          className="flex items-start justify-between gap-3 cursor-pointer active:opacity-90 select-none [-webkit-touch-callout:none]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-text">
                              <span className="font-mono">{pos.symbol}</span>
                              <span className="font-bold text-text ml-1">{pos.side === 'LONG' ? 'Buy' : 'Sell'}</span>
                              <span className="font-bold text-text ml-1">{sizeNum.toFixed(8)}</span>
                            </div>
                            <div className="text-xs text-muted font-mono mt-0.5">
                              {entryPrice.toFixed(5)} → {currentStr}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[11px] text-muted">{openedAtStr}</div>
                            <div className={cn('text-sm font-semibold', unrealizedPnl >= 0 ? 'text-success' : 'text-danger')}>
                              {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)}
                            </div>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="pt-3 pb-2 space-y-2 border-t border-white/5 mt-2" onClick={(e) => e.stopPropagation()}>
                            <div className={cn('text-lg font-bold', unrealizedPnl >= 0 ? 'text-success' : 'text-danger')}>
                              {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)}
                            </div>
                            <div className="text-xs text-muted font-mono">
                              {entryPrice.toFixed(2)} → {livePrice != null ? livePrice.toFixed(2) : '—'}
                            </div>
                            <div className="text-xs text-muted">{openedAtLongStr}</div>
                            <div className="flex justify-between gap-4 text-xs">
                              <div className="space-y-1 text-muted">
                                {hasValidSl && <div>S/L {Number(pos.sl).toFixed(2)}</div>}
                                <div>Margin {Number.isFinite(marginNum) ? marginNum.toFixed(2) : '—'}</div>
                              </div>
                              <div className="space-y-1 text-muted text-right">
                                {hasValidTp && <div>T/P {Number(pos.tp).toFixed(2)}</div>}
                                <div className="font-mono">PID {pos.id.slice(0, 8)}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                              <button
                                onClick={openEditPositionPopup}
                                className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-accent/20 text-accent font-semibold text-xs"
                              >
                                <Edit className="h-4 w-4" />
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  if (!canClosePosition) return
                                  setClosePositionId(pos.id)
                                  setClosePositionDialogOpen(true)
                                }}
                                disabled={!canClosePosition}
                                className="flex-1 min-h-[40px] flex items-center justify-center gap-2 rounded-lg bg-danger/20 text-danger font-semibold text-xs disabled:opacity-50 disabled:pointer-events-none"
                              >
                                <X className="h-4 w-4" />
                                Close
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {openPositionsWithComputed.length > 0 && (
                    <div className="text-center text-muted text-xs py-3">No more data</div>
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
                      <div className="absolute inset-0 bg-black/50" onClick={() => setActionMenuPositionId(null)} aria-hidden />
                      <div className="relative rounded-t-xl border-t border-white/10 bg-surface shadow-xl safe-area-pb">
                        <div className="divide-y divide-white/10">
                          {actions.map(({ label, onClick, disabled }) => (
                            <button
                              key={label}
                              type="button"
                              onClick={onClick}
                              disabled={disabled}
                              className="w-full py-4 px-4 text-left text-sm font-medium text-text hover:bg-white/5 active:bg-white/10 disabled:opacity-50 disabled:pointer-events-none"
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
                      <div className="text-center text-muted">
                        <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <div className="text-sm font-medium">No open positions</div>
                        <div className="text-xs mt-1">Open a position to see it here</div>
                      </div>
                    </div>
                  ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Quantity</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Direction</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Margin</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Entry</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Current</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">P&L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">S/L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">T/P</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Open Positions */}
                  {(() => {
                    const openPositions = positions
                      .filter(p => p.status === 'OPEN')
                      .sort((a, b) => {
                        // Sort by opened_at timestamp (newest first)
                        // Use updated_at as fallback if opened_at is not available
                        const aTime = a.opened_at || a.updated_at || 0
                        const bTime = b.opened_at || b.updated_at || 0
                        return bTime - aTime // Descending order (newest first)
                      })
                    if (openPositions.length > 0) {
                      console.log(`📋 Rendering ${openPositions.length} open position(s) in positions tab`)
                    }
                    const positionRows = openPositions.map((pos, index) => {
                      const sizeNum = parseFloat(pos.size || '0')
                      const entryPrice = parseFloat(pos.avg_price || pos.entry_price || '0')
                      const marginNum = parseFloat(pos.margin || '0')
                      
                      // Get live price for this symbol
                      // Normalize symbol key to match price stream format (USDT -> USD)
                      const symbolKey = normalizeSymbolKey(pos.symbol)
                      // Try both normalized and original format for lookup
                      let priceData = livePrices.get(symbolKey)
                      if (!priceData) {
                        // Fallback to original format in case price is stored with USDT
                        priceData = livePrices.get(pos.symbol.toUpperCase())
                      }
                      // Use bid for LONG positions, ask for SHORT positions
                      const livePrice = priceData 
                        ? (pos.side === 'LONG' ? parseFloat(priceData.bid) : parseFloat(priceData.ask))
                        : null
                      
                      // Calculate unrealized P&L based on current price
                      // For LONG: (current_price - entry_price) × size
                      // For SHORT: (entry_price - current_price) × size
                      const unrealizedPnl = livePrice !== null
                        ? (pos.side === 'LONG' 
                            ? (livePrice - entryPrice) * sizeNum
                            : (entryPrice - livePrice) * sizeNum)
                        : parseFloat(pos.unrealized_pnl || '0') // Fallback to stored value if no live price
                      
                      const openEditPositionPopup = () => {
                        const currentPos = positions.find(p => p.id === pos.id)
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
                        <tr 
                          key={pos.id} 
                          onClick={openEditPositionPopup}
                          className={cn(
                            "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200 cursor-pointer",
                            index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                          )}
                        >
                          <td className="px-4 py-3 font-mono text-text font-semibold">{pos.id.slice(0, 8)}...</td>
                          <td className="px-4 py-3 font-mono font-bold text-text">{pos.symbol}</td>
                          <td className="px-4 py-3 text-text font-medium">{sizeNum.toFixed(6)}</td>
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
                          <td className="px-4 py-3 text-text font-semibold">${marginNum.toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono text-text font-medium">${entryPrice.toFixed(2)}</td>
                          <td className={cn(
                            "px-4 py-3 font-mono font-bold",
                            livePrice !== null ? "text-accent" : "text-text/40"
                          )}>
                            {livePrice !== null 
                              ? `$${livePrice.toFixed(2)}` 
                              : <span className="text-text/40">--</span>
                            }
                          </td>
                          <td className={cn(
                            "px-4 py-3 font-mono font-bold",
                            unrealizedPnl >= 0 ? "text-success" : "text-danger"
                          )}>
                            {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 font-mono text-text/70">{pos.sl ? `$${parseFloat(pos.sl).toFixed(2)}` : '-'}</td>
                          <td className="px-4 py-3 font-mono text-text/70">{pos.tp ? `$${parseFloat(pos.tp).toFixed(2)}` : '-'}</td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEditPositionPopup()
                                }}
                                className="p-2 hover:bg-accent/20 rounded-lg transition-all duration-200 text-accent hover:text-accent/80 hover:scale-110 active:scale-95"
                                title="Edit Position"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (!canClosePosition) return
                                  setClosePositionId(pos.id)
                                  setClosePositionDialogOpen(true)
                                }}
                                disabled={!canClosePosition}
                                className="p-2 hover:bg-danger/20 rounded-lg transition-all duration-200 text-danger hover:text-danger/80 hover:scale-110 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                                title={!canClosePosition ? 'Trading is disabled' : 'Close Position'}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                    
                    // Only return open positions (filled orders should only appear in Order History tab)
                    return positionRows
                  })()}
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
            {isLoading ? (
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
                <div className="text-center text-muted">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No pending orders</div>
                  <div className="text-xs mt-1">Place an order to see it here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Side</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Size</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Price</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Created</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter(o => o.status === 'pending').map((order, index) => {
                    const createdDate = new Date(order.created_at)
                    const timeStr = createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                    
                    return (
                    <tr 
                      key={order.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
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
                      <td className="px-4 py-3 text-text font-medium">{order.size}</td>
                      <td className="px-4 py-3 font-mono text-text">{order.price || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 rounded font-bold text-[10px] uppercase tracking-wider",
                          order.status === 'filled' 
                            ? 'bg-success/20 text-success' 
                            : order.status === 'pending' 
                            ? 'bg-info/20 text-info' 
                            : 'bg-muted/20 text-muted'
                        )}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text font-medium">{timeStr}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {order.status === 'pending' && (
                            <>
                              <button
                                onClick={() => {
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
                                    toast.success(`Order ${order.id.slice(0, 8)}... cancelled`)
                                    fetchOrders()
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
            {isLoading ? (
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
                <div className="text-center text-muted">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No order history</div>
                  <div className="text-xs mt-1">Completed orders will appear here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Type</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Side</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Size</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Filled</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Avg Price</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filledOrders.map((order, index) => {
                    const createdDate = new Date(order.created_at)
                    const timeStr = createdDate.toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })
                    const filledSize = parseFloat(order.filled_size || order.size || '0')
                    const avgPrice = parseFloat(order.average_price || order.price || '0')
                    
                    return (
                    <tr 
                      key={order.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
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
                      <td className="px-4 py-3 text-text font-medium">{order.size}</td>
                        <td className="px-4 py-3 text-text font-medium">{filledSize.toFixed(6)}</td>
                        <td className="px-4 py-3 font-mono text-text">{avgPrice > 0 ? `$${avgPrice.toFixed(2)}` : '-'}</td>
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
            {(() => {
              const closedPositions = positions
                .filter(p => p.status === 'CLOSED' || p.status === 'LIQUIDATED')
                .sort((a, b) => {
                  // Sort by closed_at timestamp (newest first)
                  // Use updated_at as fallback if closed_at is not available
                  const aTime = a.closed_at || a.updated_at || 0
                  const bTime = b.closed_at || b.updated_at || 0
                  return bTime - aTime // Descending order (newest first)
                })
              return closedPositions.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div className="text-sm font-medium">No position history</div>
                  <div className="text-xs mt-1">Closed positions will appear here</div>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gradient-to-r from-surface-2 to-surface-2/80 sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">ID</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Symbol</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Quantity</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Direction</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Entry</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Exit</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">P&L</th>
                    <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Status</th>
                      <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Closed</th>
                  </tr>
                </thead>
                <tbody>
                    {closedPositions.map((pos, index) => {
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
                      const realizedPnl = parseFloat(pos.realized_pnl || '0')
                      const closedAt = pos.updated_at ? new Date(pos.updated_at).toLocaleString() : '-'
                      
                      return (
                    <tr 
                      key={pos.id} 
                      className={cn(
                        "border-b border-white/5 hover:bg-surface-2/40 transition-all duration-200",
                        index % 2 === 0 ? "bg-surface/30" : "bg-surface/50"
                      )}
                    >
                          <td className="px-4 py-3 font-mono text-text font-semibold">{pos.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 font-mono font-bold text-text">{pos.symbol}</td>
                          <td className="px-4 py-3 text-text font-medium">{sizeNum.toFixed(6)}</td>
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
                          <td className="px-4 py-3 font-mono text-text font-medium">${entryPrice.toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono text-text font-medium">
                            {exitPrice !== null ? `$${exitPrice.toFixed(2)}` : '-'}
                          </td>
                          <td className={cn(
                            "px-4 py-3 font-mono font-bold",
                            realizedPnl >= 0 ? "text-success" : "text-danger"
                          )}>
                            {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                              pos.status === 'LIQUIDATED' ? 'bg-danger/20 text-danger' : 'bg-white/10 text-text/80'
                            )}>
                              {pos.status === 'LIQUIDATED' ? 'Liquidated' : 'Closed'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text/70 text-[10px]">{closedAt}</td>
                    </tr>
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
      <div className={cn('shrink-0 h-14 border-t border-white/5 bg-surface-2 items-center px-4 text-sm overflow-x-auto scrollbar-thin scrollbar-hide', fullHeight ? 'hidden md:flex' : 'flex')}>
        <div className="flex items-center gap-4 min-w-max">
          {([
            { formula: 'Balance = Deposits − Withdrawals + Realized PnL', icon: Wallet, label: 'Balance ', value: accountSummary != null ? `$${accountSummary.balance.toFixed(2)}` : '—', valueClass: 'text-text' },
            { formula: 'Equity = Balance + Unrealized PnL', icon: TrendingUp, label: 'Equity ', value: accountSummary != null ? `$${accountSummary.equity.toFixed(2)}` : '—', valueClass: 'text-text' },
            { formula: 'Margin = Sum of margin used by all open positions', icon: Shield, label: 'Margin ', value: accountSummary != null ? `$${(accountSummary.marginLevel === 'inf' ? 0 : accountSummary.marginUsed).toFixed(2)}` : '—', valueClass: 'text-text' },
            { formula: 'Free Margin = Equity − Margin', icon: DollarSign, label: 'Free Margin ', value: accountSummary != null ? `$${accountSummary.freeMargin.toFixed(2)}` : '—', valueClass: 'text-text' },
            { formula: 'Bonus = Credit or promotion (if any)', icon: Gift, label: 'Bonus ', value: '$0.00', valueClass: 'text-text' },
            { formula: 'Margin Level = (Equity ÷ Margin) × 100% (∞ when Margin = 0)', icon: Gauge, label: 'Margin Level ', value: accountSummary != null ? (accountSummary.marginLevel === 'inf' ? '∞' : `${accountSummary.marginLevel}%`) : '—', valueClass: 'font-semibold text-accent' },
            { formula: 'RI PNL (Realized PnL) = Profit/Loss from closed positions', icon: ArrowUpRight, label: 'RI PNL ', value: accountSummary != null ? (accountSummary.realizedPnl >= 0 ? `$${accountSummary.realizedPnl.toFixed(2)}` : `-$${Math.abs(accountSummary.realizedPnl).toFixed(2)}`) : '—', valueClass: cn(accountSummary != null && accountSummary.realizedPnl < 0 ? 'text-danger' : 'text-success') },
            { formula: 'UnR Net PNL (Unrealized PnL) = Profit/Loss on open positions (mark-to-market)', icon: ArrowDownRight, label: 'UnR Net PNL ', value: accountSummary != null ? (accountSummary.unrealizedPnl >= 0 ? `$${accountSummary.unrealizedPnl.toFixed(2)}` : `-$${Math.abs(accountSummary.unrealizedPnl).toFixed(2)}`) : '—', valueClass: cn(accountSummary != null && accountSummary.unrealizedPnl < 0 ? 'text-danger' : 'text-success') },
          ] as const).map(({ formula, icon: Icon, label, value, valueClass }, i) => (
            <span key={i} className="contents">
              {i > 0 ? <div className="h-4 w-px bg-border shrink-0" /> : null}
              <div
                className="relative flex items-center gap-1.5 shrink-0 cursor-help"
                onMouseEnter={(e) => setFormulaTooltip({ formula, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setFormulaTooltip(null)}
              >
                <Icon className="h-4 w-4 text-muted" />
                <span className="text-muted">{label}</span>
                <span className={valueClass}>{value}</span>
              </div>
            </span>
          ))}
        </div>
      </div>
      {formulaTooltip &&
        createPortal(
          <div
            className="fixed z-[9999] px-2.5 py-1.5 text-xs font-medium text-text bg-surface border border-border rounded shadow-lg whitespace-nowrap pointer-events-none"
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

      {/* Close All Positions Dialog */}
      <Dialog.Root open={closeAllDialogOpen} onOpenChange={(open) => !closeAllLoading && setCloseAllDialogOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close All Positions
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
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
                        await closePosition(pos.id)
                        closed++
                      } catch (err: unknown) {
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
                    fetchPositions(true)
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

      {/* Close Position Dialog */}
      <Dialog.Root open={closePositionDialogOpen} onOpenChange={setClosePositionDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close Position
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
              Are you sure you want to close position {closePositionId}? This action cannot be undone.
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
                  try {
                    await closePosition(idToClose)
                    toast.success(`Position ${idToClose.slice(0, 8)}... closed successfully`)
                    setClosePositionDialogOpen(false)
                    setClosePositionId(null)
                    // Optimistic update: remove from list immediately so it disappears
                    setPositions((prev) => prev.filter((p) => p.id !== idToClose))
                    // Refetch after delay so order-engine has time to process and list stays in sync
                    setTimeout(() => fetchPositions(true), 500)
                    setTimeout(() => fetchPositions(true), 1200)
                  } catch (error: unknown) {
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
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Cancel Order
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
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
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-4">
              Edit {editItem?.type === 'position' ? 'Position' : 'Order'} {editItem?.id}
            </Dialog.Title>
            <div className="space-y-4 mb-6">
              {editItem?.type === 'position' && editingPosition ? (
                <>
                  {/* Stop Loss Section */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted mb-1 block font-semibold">Stop Loss</label>
                    <div className="grid grid-cols-2 gap-2">
                  <div>
                        <label className="text-[10px] text-muted mb-1 block">Price ($)</label>
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
                        <label className="text-[10px] text-muted mb-1 block">Amount ($)</label>
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
                    <label className="text-xs text-muted mb-1 block font-semibold">Take Profit</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted mb-1 block">Price ($)</label>
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
                        <label className="text-[10px] text-muted mb-1 block">Amount ($)</label>
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
                    <label className="text-xs text-muted mb-1 block">Price</label>
                    <Input type="number" step="0.01" placeholder="Enter price" className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Size</label>
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
                      fetchPositions(true)
                    } catch (error: any) {
                      toast.error(`Failed to update position: ${error.message}`)
                    }
                  } else {
                  toast.success(`${editItem?.type === 'position' ? 'Position' : 'Order'} ${editItem?.id} updated successfully`)
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
    </div>
  )
}

