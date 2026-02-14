import { Columns, Download, Wallet, TrendingUp, Shield, DollarSign, Gift, Percent, ArrowUpRight, ArrowDownRight, X, Edit, Trash2, XCircle, Package, FileText, History, Bot, AlertCircle } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { cn } from '@/shared/utils'
import { toast } from 'react-hot-toast'
import * as Dialog from '@radix-ui/react-dialog'
import { Input, Skeleton } from '@/shared/ui'
import { getPositions, Position, updatePositionSltp, closePosition } from '../api/positions.api'
import { listOrders, Order, cancelOrder as cancelOrderApi } from '../api/orders.api'
import { useAuthStore } from '@/shared/store/auth.store'
import { usePriceStream } from '@/features/symbols/hooks/usePriceStream'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'

export function BottomDock() {
  // Valid tab IDs
  const validTabs = ['positions', 'orders', 'order-history', 'position-history', 'bot-positions']
  
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
  const [filledOrders, setFilledOrders] = useState<Order[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastPositionCountRef = useRef<number>(0)

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

  const tabs = [
    { id: 'positions', label: 'Positions' },
    { id: 'orders', label: 'Orders' },
    { id: 'order-history', label: 'Order History' },
    { id: 'position-history', label: 'Position History' },
    { id: 'bot-positions', label: 'Bot Positions' },
  ]
  
  // Handler to change tab and persist to localStorage
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId)
    localStorage.setItem('bottomDockActiveTab', tabId)
  }, [])

  // Fetch positions from API
  const fetchPositions = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getPositions()
      console.log('📍 Positions fetched from API:', {
        count: data.length,
        open_positions: data.filter(p => p.status === 'OPEN').length,
        positions: data.map(p => ({
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          status: p.status,
          size: p.size
        }))
      })
      setPositions(data)
      const openCount = data.filter(p => p.status === 'OPEN').length
      if (openCount > 0) {
        console.log(`✅ ${openCount} open position(s) loaded and will appear in positions tab`)
      }
    } catch (error: any) {
      console.error('❌ Failed to fetch positions:', error)
      toast.error('Failed to load positions')
    } finally {
      setIsLoading(false)
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

  // Initial fetch on mount - always load positions immediately on page load
  // This ensures positions are available right away, even before user switches to positions tab
  useEffect(() => {
    console.log('🔄 BottomDock mounted, fetching positions immediately...')
    fetchPositions().then(() => {
      // Store initial position count after fetch completes
      setTimeout(() => {
        lastPositionCountRef.current = positions.length
      }, 100)
    })
    // Also fetch orders on mount so they're ready
    fetchOrders()
  }, [fetchPositions, fetchOrders]) // Use callbacks in deps - they're stable (useCallback)

  // Polling fallback: Check for new positions every 2 seconds when on positions tab
  // This ensures positions appear even if WebSocket doesn't work
  useEffect(() => {
    if (activeTab === 'positions') {
      pollingIntervalRef.current = setInterval(() => {
        console.log('🔄 [BottomDock] Polling for new positions (every 2s)...')
        fetchPositions().then(() => {
          const currentCount = positions.filter(p => p.status === 'OPEN').length
          if (currentCount !== lastPositionCountRef.current) {
            console.log(`✅ [BottomDock] Position count changed: ${lastPositionCountRef.current} → ${currentCount}`)
            lastPositionCountRef.current = currentCount
          }
        })
      }, 2000) // Poll every 2 seconds
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

  // Fetch data when tab changes (for refreshing data when switching tabs)
  useEffect(() => {
    if (activeTab === 'positions') {
      // Refresh positions when switching to positions tab
      fetchPositions()
      fetchFilledOrders() // Also fetch filled orders for positions tab
    } else if (activeTab === 'orders') {
      // Refresh orders when switching to orders tab
      fetchOrders()
    } else if (activeTab === 'order-history') {
      fetchFilledOrders() // Fetch filled orders for order history tab
    }
  }, [activeTab, fetchPositions, fetchOrders, fetchFilledOrders])

  // WebSocket for real-time position updates
  useEffect(() => {
    const accessToken = useAuthStore.getState().accessToken
    if (!accessToken) {
      console.warn('No access token available for WebSocket authentication')
      return
    }

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3003/ws?group=default'
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('✅ WebSocket opened, authenticating...')
      setWsConnected(true)
      // Authenticate with JWT token
      try {
        const authMessage = JSON.stringify({ type: 'auth', token: accessToken })
        console.log('Sending auth message:', { type: 'auth', token: accessToken ? `${accessToken.substring(0, 20)}...` : 'null' })
        ws.send(authMessage)
      } catch (error) {
        console.error('Failed to send auth message:', error)
      }
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('📨 [BottomDock] WebSocket message received:', {
          type: data.type,
          hasPayload: !!data.payload,
          fullData: data
        })
        
        // Log ALL messages to help debug
        if (data.type !== 'pong' && data.type !== 'tick') {
          console.log('📨 [BottomDock] Non-tick message:', JSON.stringify(data, null, 2))
        }
        
        // Handle auth responses
        if (data.type === 'auth_success') {
          console.log('✅ WebSocket authenticated successfully:', data)
          // Subscribe to positions and orders channels after successful authentication
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              const subscribeMsg = { type: 'subscribe', symbols: [], channels: ['positions', 'orders'] }
              ws.send(JSON.stringify(subscribeMsg))
              console.log('📡 [BottomDock] Subscribed to channels after auth:', subscribeMsg.channels)
            }
          }, 500) // Delay to ensure connection is fully ready
        } else if (data.type === 'auth_error') {
          console.error('❌ WebSocket authentication failed:', data.error)
          toast.error(`WebSocket auth failed: ${data.error}`)
        }
        
        // Handle position update events - check for position_update type
        // The backend sends: { type: 'position_update', position_id, symbol, side, quantity, status, ... }
        if (data.type === 'position_update') {
          console.log('📊 [BottomDock] Position update received (position_update type):', data)
          
          // For position_update, all fields are directly on data
          const positionId = data.position_id
          if (!positionId) {
            console.warn('⚠️ [BottomDock] Position update missing position_id:', data)
            return
          }
          
          const positionStatus = data.status || 'OPEN'
          const isOpen = positionStatus === 'OPEN' || positionStatus === 'open'
          
          console.log('📊 [BottomDock] Processing position update:', {
            positionId,
            symbol: data.symbol,
            side: data.side,
            status: positionStatus,
            isOpen,
            quantity: data.quantity
          })
          
          setPositions(prev => {
            const existing = prev.findIndex(p => p.id === positionId)
            
            if (existing >= 0) {
              // Update existing position
              const updated = [...prev]
              updated[existing] = {
                ...updated[existing],
                id: positionId,
                symbol: data.symbol || updated[existing].symbol,
                side: (data.side || updated[existing].side) as 'LONG' | 'SHORT',
                size: data.quantity || updated[existing].size,
                unrealized_pnl: data.unrealized_pnl || updated[existing].unrealized_pnl,
                status: positionStatus as 'OPEN' | 'CLOSED',
                updated_at: Date.now(),
              }
              console.log('✅ [BottomDock] Position updated in state:', updated[existing])
              return updated
            } else if (isOpen) {
              // Add new position immediately
              console.log('✅ [BottomDock] Adding NEW position immediately:', {
                positionId,
                symbol: data.symbol,
                side: data.side,
                status: positionStatus
              })
              
              const newPosition: Position = {
                id: positionId,
                user_id: '',
                symbol: data.symbol || '',
                side: (data.side === 'LONG' || data.side === 'long' ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
                size: data.quantity || '0',
                original_size: undefined,
                entry_price: '0', // Will be filled by fetchPositions
                avg_price: '0', // Will be filled by fetchPositions
                exit_price: undefined,
                sl: undefined,
                tp: undefined,
                leverage: '50',
                margin: '0', // Will be filled by fetchPositions
                unrealized_pnl: data.unrealized_pnl || '0',
                realized_pnl: '0',
                status: positionStatus as 'OPEN' | 'CLOSED',
                opened_at: Date.now(),
                updated_at: Date.now(),
                closed_at: undefined,
              }
              
              console.log('✅ [BottomDock] New position object created:', newPosition)
              console.log('✅ [BottomDock] Current positions count:', prev.length, 'Adding new one, will be:', prev.length + 1)
              
              // Fetch full position data in background
              setTimeout(() => {
                console.log('🔄 [BottomDock] Fetching full position data in background...')
                fetchPositions()
              }, 500)
              
              return [...prev, newPosition]
            } else if (positionStatus === 'CLOSED' || positionStatus === 'closed') {
              // Position was closed, remove from list
              console.log('📊 [BottomDock] Position closed, removing from list:', positionId)
              return prev.filter(p => p.id !== positionId)
            }
            
            console.warn('⚠️ [BottomDock] Position update not processed:', { positionId, positionStatus, isOpen })
            return prev
          })
        }
        
        // Handle SL/TP trigger notifications
        if (data.type === 'position_update' && data.trigger_reason) {
          const triggerReason = data.trigger_reason
          if (triggerReason === 'SL' || triggerReason === 'TP') {
            const triggerType = triggerReason === 'SL' ? 'Stop Loss' : 'Take Profit'
            const symbol = data.symbol || 'Unknown'
            const side = data.side || 'Unknown'
            console.log('🎯 [BottomDock] Showing toaster for', triggerType, 'on', side, symbol)
            toast.success(
              `🎯 ${triggerType} Triggered!`,
              {
                description: `${side} ${symbol} position closed`,
                duration: 5000,
              }
            )
          }
        }
        
        // Handle order update events
        if (data.type === 'order_update' && data.payload) {
          const orderUpdate = data.payload
          console.log('📦 Order update received:', orderUpdate)
          setOrders(prev => {
            const existing = prev.findIndex(o => o.id === orderUpdate.order_id)
            if (existing >= 0) {
              // Update existing order
              const updated = [...prev]
              updated[existing] = {
                ...updated[existing],
                status: orderUpdate.status?.toLowerCase() || updated[existing].status,
                filled_size: orderUpdate.filled_size?.toString() || updated[existing].filled_size,
                avg_fill_price: orderUpdate.avg_fill_price?.toString() || updated[existing].avg_fill_price,
              }
              // Remove if filled or cancelled
              if (orderUpdate.status === 'FILLED' || orderUpdate.status === 'CANCELLED') {
                console.log('✅ [BottomDock] Order filled/cancelled, removing from list:', orderUpdate.order_id)
                // If filled, immediately fetch positions multiple times to ensure we catch the new position
                // This is a fallback in case WebSocket position_update doesn't arrive immediately
                if (orderUpdate.status === 'FILLED') {
                  console.log('📊 [BottomDock] Order filled, fetching positions immediately to show new position...')
                  
                  // Fetch immediately
                  fetchPositions().then(() => {
                    const currentCount = positions.filter(p => p.status === 'OPEN').length
                    lastPositionCountRef.current = currentCount
                  })
                  fetchFilledOrders()
                  
                  // Aggressive polling after order fill - check every 500ms for 5 seconds
                  let pollCount = 0
                  const aggressivePoll = setInterval(() => {
                    pollCount++
                    if (pollCount > 10) { // 10 * 500ms = 5 seconds
                      clearInterval(aggressivePoll)
                      return
                    }
                    console.log(`🔄 [BottomDock] Aggressive poll #${pollCount} after order fill...`)
                    fetchPositions().then(() => {
                      const currentCount = positions.filter(p => p.status === 'OPEN').length
                      if (currentCount > lastPositionCountRef.current) {
                        console.log(`✅ [BottomDock] Found new position via aggressive polling! Count: ${lastPositionCountRef.current} → ${currentCount}`)
                        lastPositionCountRef.current = currentCount
                      }
                    })
                  }, 500) // Poll every 500ms
                }
                return updated.filter((_, i) => i !== existing)
              }
              return updated
            } else if (orderUpdate.status === 'PENDING') {
              // Add new pending order
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

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      console.error('WebSocket error details:', {
        readyState: ws.readyState,
        url: wsUrl,
        hasToken: !!accessToken
      })
    }

    ws.onclose = (event) => {
      console.log('🔌 WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
      setWsConnected(false)
    }

    wsRef.current = ws

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  // Fetch data immediately when tab changes (don't wait for WebSocket)
  useEffect(() => {
    if (activeTab === 'positions') {
      fetchPositions() // Only fetch positions (open positions will be filtered in render)
    } else if (activeTab === 'orders') {
      fetchOrders()
    } else if (activeTab === 'order-history') {
      setIsLoading(true)
      fetchFilledOrders().finally(() => setIsLoading(false)) // Fetch filled orders for order history tab
    } else if (activeTab === 'position-history') {
      fetchPositions() // Fetch all positions (includes closed ones)
    }
  }, [activeTab, fetchPositions, fetchOrders, fetchFilledOrders])

  // WebSocket handles real-time updates, no polling needed

  return (
    <div className="h-[300px] min-h-0 overflow-hidden flex flex-col border-t border-white/5 bg-gradient-to-b from-surface to-surface-2/30 shadow-lg shadow-black/10">
      {/* Tab Strip + Toolbar - Enhanced */}
      <div className="shrink-0 h-12 border-b border-white/5 flex items-center justify-between px-4 bg-gradient-to-r from-white/[0.02] to-transparent">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                'px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 relative uppercase tracking-wider',
                activeTab === tab.id
                  ? 'bg-accent text-white shadow-md shadow-accent/20'
                  : 'text-muted hover:text-text hover:bg-surface-2/50'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white"></div>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'positions' && (
            <button
              onClick={() => toast.success('All positions closed successfully')}
              className="px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5 border border-transparent"
              title="Close All Positions"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span>Close All</span>
            </button>
          )}
          <button
            onClick={() => toast.info('Column customization coming soon')}
            className="px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5"
            title="Customize Columns"
          >
            <Columns className="h-3.5 w-3.5" />
            <span>Columns</span>
          </button>
          <button
            onClick={() => toast.success('Data exported successfully')}
            className="px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-1.5"
            title="Export Data"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {activeTab === 'positions' && (
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
            ) : positions.length === 0 && filledOrders.length === 0 ? (
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
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  const currentPos = positions.find(p => p.id === pos.id)
                                  if (currentPos) {
                                    setEditingPosition(currentPos)
                                  setEditItem({ type: 'position', id: pos.id })
                                    const slPrice = currentPos.sl && currentPos.sl !== 'null' ? currentPos.sl : ''
                                    const tpPrice = currentPos.tp && currentPos.tp !== 'null' ? currentPos.tp : ''
                                    setEditSl(slPrice)
                                    setEditTp(tpPrice)
                                    
                                    // Calculate dollar amounts from prices
                                    if (slPrice) {
                                      const entryPrice = parseFloat(currentPos.avg_price || currentPos.entry_price || '0')
                                      const sizeNum = parseFloat(currentPos.size || '0')
                                      const slPriceNum = parseFloat(slPrice)
                                      const slAmount = currentPos.side === 'LONG' 
                                        ? (entryPrice - slPriceNum) * sizeNum // Loss for LONG
                                        : (slPriceNum - entryPrice) * sizeNum // Loss for SHORT
                                      setEditSlAmount(slAmount > 0 ? slAmount.toFixed(2) : '')
                                    } else {
                                      setEditSlAmount('')
                                    }
                                    
                                    if (tpPrice) {
                                      const entryPrice = parseFloat(currentPos.avg_price || currentPos.entry_price || '0')
                                      const sizeNum = parseFloat(currentPos.size || '0')
                                      const tpPriceNum = parseFloat(tpPrice)
                                      const tpAmount = currentPos.side === 'LONG'
                                        ? (tpPriceNum - entryPrice) * sizeNum // Profit for LONG
                                        : (entryPrice - tpPriceNum) * sizeNum // Profit for SHORT
                                      setEditTpAmount(tpAmount > 0 ? tpAmount.toFixed(2) : '')
                                    } else {
                                      setEditTpAmount('')
                                    }
                                  setEditDialogOpen(true)
                                  }
                                }}
                                className="p-2 hover:bg-accent/20 rounded-lg transition-all duration-200 text-accent hover:text-accent/80 hover:scale-110 active:scale-95"
                                title="Edit Position"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setClosePositionId(pos.id)
                                  setClosePositionDialogOpen(true)
                                }}
                                className="p-2 hover:bg-danger/20 rounded-lg transition-all duration-200 text-danger hover:text-danger/80 hover:scale-110 active:scale-95"
                                title="Close Position"
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
          </>
        )}

        {activeTab === 'orders' && (
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

        {activeTab === 'order-history' && (
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

        {activeTab === 'position-history' && (
          <>
            {(() => {
              const closedPositions = positions
                .filter(p => p.status === 'CLOSED')
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
                      <th className="px-4 py-3 text-left text-[10px] text-muted/80 uppercase font-bold tracking-widest">Closed</th>
                  </tr>
                </thead>
                <tbody>
                    {closedPositions.map((pos, index) => {
                      // Use original_size for closed positions if available, otherwise use size
                      const sizeValue = pos.status === 'CLOSED' && pos.original_size 
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

        {activeTab === 'bot-positions' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted">
              <Bot className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <div className="text-sm font-medium">No bot positions</div>
              <div className="text-xs mt-1">Bot trading positions will appear here</div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Stats Bar */}
      <div className="shrink-0 h-14 border-t border-white/5 bg-surface-2 flex items-center px-4 text-sm overflow-x-auto scrollbar-thin scrollbar-hide">
        <div className="flex items-center gap-4 min-w-max">
          <div className="flex items-center gap-1.5 shrink-0">
            <Wallet className="h-4 w-4 text-muted" />
            <span className="text-muted">Balance </span>
            <span className="text-text">$2,495.56</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <TrendingUp className="h-4 w-4 text-muted" />
            <span className="text-muted">Equity </span>
            <span className="text-text">$2,495.68</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Shield className="h-4 w-4 text-muted" />
            <span className="text-muted">Margin </span>
            <span className="text-text">$22.28</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <DollarSign className="h-4 w-4 text-muted" />
            <span className="text-muted">Free Margin </span>
            <span className="text-text">$2,473.40</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Gift className="h-4 w-4 text-muted" />
            <span className="text-muted">Bonus </span>
            <span className="text-text">$0.00</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Percent className="h-4 w-4 text-muted" />
            <span className="text-muted">Margin Level </span>
            <span className="text-text">11199.80%</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ArrowUpRight className="h-4 w-4 text-success" />
            <span className="text-muted">RI PNL </span>
            <span className="text-success">$2,472.56</span>
          </div>
          <div className="h-4 w-px bg-border shrink-0"></div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ArrowDownRight className="h-4 w-4 text-success" />
            <span className="text-muted">UnR Net PNL </span>
            <span className="text-success">$0.12</span>
          </div>
        </div>
      </div>

      {/* Close All Positions Dialog */}
      <Dialog.Root open={closeAllDialogOpen} onOpenChange={setCloseAllDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 z-50 w-full max-w-md">
            <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger" />
              Close All Positions
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted mb-6">
              Are you sure you want to close all open positions? This action cannot be undone.
            </Dialog.Description>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setCloseAllDialogOpen(false)}
                className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toast.success('All positions closed successfully')
                  setCloseAllDialogOpen(false)
                }}
                className="px-4 py-2 text-sm bg-danger text-white hover:bg-danger/90 rounded transition-colors"
              >
                Close All
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
                  try {
                    await closePosition(closePositionId)
                    toast.success(`Position ${closePositionId.slice(0, 8)}... closed successfully`)
                  setClosePositionDialogOpen(false)
                  setClosePositionId(null)
                    // Refresh positions list
                    fetchPositions()
                  } catch (error: any) {
                    toast.error(`Failed to close position: ${error.message}`)
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
                      // Refresh positions
                      fetchPositions()
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

