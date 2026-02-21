import { Search, Grid3x3, Bell, CreditCard, MessageCircle, Star, ChevronDown, ChevronUp, Settings, LogOut, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Skeleton } from '@/shared/ui'
import { useTerminalStore } from '../store'
import { useAuthStore } from '@/shared/store/auth.store'
import { useWalletStore } from '@/shared/store/walletStore'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { cn } from '@/shared/utils'
import { useState, useRef, useEffect, useCallback } from 'react'
import { PriceDisplay } from './PriceDisplay'
import { DepositModal } from '@/features/wallet/components/DepositModal'
import { WithdrawModal } from '@/features/wallet/components/WithdrawModal'
import { fetchBalance } from '@/features/wallet/api'
import { useQueryClient } from '@tanstack/react-query'
import { useAccountSummary, accountSummaryQueryKey } from '@/features/wallet/hooks/useAccountSummary'
import { useWebSocketSubscription, useWebSocketState } from '@/shared/ws/wsHooks'
import { WsInboundEvent } from '@/shared/ws/wsEvents'
import { wsClient } from '@/shared/ws/wsClient'

interface LeftSidebarProps {
  /** When provided, Deposit button opens parent's deposit modal and parent renders DepositModal. */
  onOpenDeposit?: () => void
}

export function LeftSidebar({ onOpenDeposit }: LeftSidebarProps = {}) {
  const {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    watchlist,
    toggleWatchlist,
    selectedSymbol,
    setSelectedSymbol,
    getFilteredSymbols,
    isLoading,
    settingsPanelOpen,
    setSettingsPanelOpen,
    paymentPanelOpen,
    setPaymentPanelOpen,
    chatPanelOpen,
    setChatPanelOpen,
  } = useTerminalStore()

  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const { balance, equity, margin_used, currency, isLoading: balanceLoading, setWalletData, setLoading } = useWalletStore()
  const [cryptoExpanded, setCryptoExpanded] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const queryClient = useQueryClient()
  const { accountSummary, isLoading: accountSummaryLoading } = useAccountSummary()
  const wsState = useWebSocketState()
  const symbols = getFilteredSymbols()

  // Ensure WebSocket is connected when user is on terminal (so balance push is received)
  useEffect(() => {
    if (!user?.id) return
    if (wsState === 'disconnected') {
      wsClient.connect()
    }
  }, [user?.id, wsState])

  // Sync wallet loading state with account summary (single shared fetch)
  useEffect(() => {
    if (!accountSummaryLoading) setLoading(false)
  }, [accountSummaryLoading, setLoading])

  // When user returns to tab, refetch account summary (e.g. after deposit approved in another tab)
  useEffect(() => {
    if (!user?.id) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') queryClient.invalidateQueries({ queryKey: accountSummaryQueryKey })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [user?.id, queryClient])

  // REST fallback: fetch balance so it always shows (WS may be slow or not fire)
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const delayMs = 800
    const timer = setTimeout(() => {
      fetchBalance()
        .then((res) => {
          if (cancelled) return
          const raw = res as unknown as Record<string, unknown>
          const available = Number(res.available ?? raw.available ?? 0)
          const locked = Number(res.locked ?? raw.locked ?? 0)
          const equity = Number(res.equity ?? raw.equity ?? available)
          const marginUsed = Number((res as any).marginUsed ?? raw.margin_used ?? raw.marginUsed ?? 0)
          const freeMargin = Number((res as any).freeMargin ?? raw.free_margin ?? raw.freeMargin ?? 0)
          setWalletData({
            balance: available,
            currency: res.currency ?? 'USD',
            available,
            locked,
            equity,
            margin_used: marginUsed,
            free_margin: freeMargin,
          })
          setLoading(false)
        })
        .catch(() => {
          if (!cancelled) setLoading(false)
        })
    }, delayMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [user?.id, setWalletData, setLoading])

  // Subscribe to WebSocket events for real-time balance updates
  useWebSocketSubscription(
    useCallback(
      (event: WsInboundEvent) => {
        console.log('📨 [LeftSidebar] Received WebSocket event:', event.type)
        
        if (event.type === 'wallet.balance.updated') {
          const payload = (event as { payload?: unknown }).payload
          if (!payload || typeof payload !== 'object') {
            setLoading(false)
            return
          }
          const pl = payload as Record<string, unknown>
          console.log('🔔 [LeftSidebar] wallet.balance.updated event received:', {
            eventUserId: pl.userId,
            currentUserId: user?.id?.toString(),
            payload: pl,
            wsState,
            isConnected: wsClient.isConnected()
          })

          const normalizeUserId = (id: string | undefined | null): string => {
            if (!id) return ''
            const str = String(id).trim().toLowerCase()
            return str.replace(/-/g, '')
          }

          const eventUserId = normalizeUserId((pl.userId ?? pl.user_id) as string | undefined)
          const currentUserId = normalizeUserId(user?.id as string | undefined)

          console.log('🔍 [LeftSidebar] User ID comparison:', {
            eventUserIdRaw: pl.userId ?? pl.user_id,
            currentUserIdRaw: user?.id,
            eventUserId,
            currentUserId,
            match: eventUserId === currentUserId
          })

          if (eventUserId && currentUserId && eventUserId === currentUserId) {
            const newBalance = Number(pl.balance ?? pl.available ?? 0)
            const currentBalance = useWalletStore.getState().balance
            const isInitialLoad = currentBalance === 0

            setLoading(false)
            setWalletData({
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
          } else {
            console.warn('⏭️ [LeftSidebar] Skipping wallet.balance.updated (different user)', { eventUserId, currentUserId })
          }
        } else {
          // Log other events for debugging
          if (event.type === 'auth_success' || event.type === 'auth_error') {
            console.log('🔐 [LeftSidebar] Auth event:', event.type, event)
          }
        }
      },
      [user?.id, setWalletData, setLoading, wsState]
    )
  )

  // Handle scroll detection to show scrollbar while scrolling
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      setIsScrolling(true)
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // Hide scrollbar after scrolling stops (500ms delay)
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false)
      }, 500)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [cryptoExpanded])

  const getUserInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    }
    if (user?.name) {
      const parts = user.name.split(' ')
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      }
      return user.name.substring(0, 2).toUpperCase()
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase()
    }
    return 'U'
  }

  const getUserDisplayName = () => {
    if (user?.name) return user.name
    if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName}`
    if (user?.email) return user.email
    return 'User'
  }

  const handleLogout = () => {
    logout()
    toast.success('Logged out successfully')
    navigate('/login')
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-gradient-to-b from-[#0f172a] via-[#0d1524] to-[#0b1220] flex flex-col border-r border-white/5">
      {/* Top User Row */}
      <div className="shrink-0 px-4 py-3.5 border-b border-white/5 bg-gradient-to-r from-white/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center text-white font-semibold text-sm shadow-lg shadow-accent/20 ring-1 ring-white/10">
              {getUserInitials()}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-[#0f172a] ring-1 ring-success/50"></div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text truncate leading-tight">{getUserDisplayName()}</div>
            <div className="text-xs text-text-muted/80 mt-0.5">Trading Account</div>
          </div>
          <div className="flex items-center gap-0.5">
            <button className="p-2 hover:bg-white/5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 group">
              <Grid3x3 className="h-4 w-4 text-text-muted group-hover:text-text transition-colors" />
            </button>
            <button className="p-2 hover:bg-white/5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 relative group">
              <Bell className="h-4 w-4 text-text-muted group-hover:text-text transition-colors" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-[#0f172a]"></span>
            </button>
            <button
              onClick={() => {
                setSettingsPanelOpen(false)
                setChatPanelOpen(false)
                setPaymentPanelOpen(!paymentPanelOpen)
              }}
              className={cn(
                'p-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 group',
                paymentPanelOpen ? 'bg-accent/15 text-accent' : 'hover:bg-white/5 text-text-muted group-hover:text-text'
              )}
              title="Deposit history"
            >
              <CreditCard className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setSettingsPanelOpen(false)
                setPaymentPanelOpen(false)
                setChatPanelOpen(!chatPanelOpen)
              }}
              className={cn(
                'p-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 group',
                chatPanelOpen ? 'bg-accent/15 text-accent' : 'hover:bg-white/5 text-text-muted group-hover:text-text'
              )}
              title="Chat"
            >
              <MessageCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Balance from WebSocket/wallet store (realtime); Equity & Margin from account summary */}
      <div className="shrink-0 px-4 py-3.5 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="space-y-2.5">
          {(() => {
            const displayBalance = balance ?? 0
            const displayEquity = accountSummary?.equity ?? equity ?? 0
            // Margin used is for open positions only; when margin level is "inf" there is no margin in use
            const displayMargin =
              accountSummary?.marginLevel === 'inf'
                ? 0
                : (accountSummary?.marginUsed ?? margin_used ?? 0)
            const hasSummary = accountSummary != null
            const balanceLoadingState = balanceLoading
            const equityMarginLoading = !hasSummary
            return (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-text-muted/70 uppercase tracking-wider">Balance</span>
                    {balanceLoadingState ? (
                      <div className="h-1.5 w-1.5 rounded-full bg-text-muted animate-pulse"></div>
                    ) : (
                      <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></div>
                    )}
                  </div>
                  <div className="text-xs font-medium text-text-muted/60">{currency || 'USD'}</div>
                </div>
                {balanceLoadingState ? (
                  <div className="flex items-baseline gap-2">
                    <Skeleton className="h-7 w-32" />
                  </div>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold text-text tracking-tight">
                      ${displayBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {displayEquity !== displayBalance && (
                      <span className={`text-xs font-medium ${displayEquity >= displayBalance ? 'text-success' : 'text-danger'}`}>
                        {displayEquity >= displayBalance ? '+' : ''}
                        ${(displayEquity - displayBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-muted/60">Equity</span>
                    {equityMarginLoading ? (
                      <Skeleton className="h-4 w-20" />
                    ) : (
                      <span className="text-xs font-semibold text-text/80">
                        ${displayEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-muted/60">Margin</span>
                    {equityMarginLoading ? (
                      <Skeleton className="h-4 w-16" />
                    ) : (
                      <span className="text-xs font-semibold text-text/80">
                        ${displayMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-4 py-3 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/60 pointer-events-none" />
          <Input
            placeholder="Search symbols..."
            className="pl-9 h-9 text-sm bg-white/5 border-white/10 focus:bg-white/10 focus:border-accent/50 transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-white/5 flex items-center gap-1.5">
        <button
          onClick={() => setActiveTab('all')}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 relative',
            activeTab === 'all'
              ? 'bg-accent text-white shadow-lg shadow-accent/20'
              : 'text-text-muted hover:text-text hover:bg-white/5'
          )}
        >
          All ({symbols.length})
        </button>
        <button
          onClick={() => setActiveTab('watchlists')}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5 relative',
            activeTab === 'watchlists'
              ? 'bg-accent text-white shadow-lg shadow-accent/20'
              : 'text-text-muted hover:text-text hover:bg-white/5'
          )}
        >
          <span>Watchlist</span>
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></span>
          <span className="text-[10px] font-medium text-success">Live</span>
        </button>
      </div>

      {/* Section Header */}
      <button
        onClick={() => setCryptoExpanded(!cryptoExpanded)}
        className="shrink-0 px-4 py-2.5 flex items-center justify-between w-full hover:bg-white/5 transition-all duration-200 group"
      >
        <div className="text-[11px] font-bold text-text/70 uppercase tracking-widest">Cryptocurrencies</div>
        {cryptoExpanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-text-muted/60 group-hover:text-text transition-colors" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-text-muted/60 group-hover:text-text transition-colors" />
        )}
      </button>

      {/* Symbols List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {cryptoExpanded && (
          <div 
            ref={scrollContainerRef}
            className={cn(
              "h-full overflow-y-auto scrollbar-thin",
              isScrolling && "scrolling"
            )}
          >
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <Skeleton className="h-3.5 w-3.5 rounded" variant="rectangular" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-16" variant="text" />
                        <Skeleton className="h-3 w-20" variant="text" />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Skeleton className="h-3 w-12" variant="text" />
                      <Skeleton className="h-4 w-10 rounded" variant="rectangular" />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              symbols.map((symbol) => (
              <div
                key={symbol.id}
                onClick={() => setSelectedSymbol(symbol)}
                className={cn(
                  'px-4 py-2.5 hover:bg-white/5 transition-all duration-200 cursor-pointer group relative',
                  selectedSymbol.id === symbol.id && 'bg-accent/10 border-l-2 border-accent'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleWatchlist(symbol.id)
                        toast.success(watchlist.has(symbol.id) ? 'Removed from watchlist' : 'Added to watchlist')
                      }}
                      className="p-1 hover:bg-white/10 rounded transition-all duration-200 hover:scale-110 active:scale-95 shrink-0 mt-0.5"
                    >
                      <Star
                        className={cn(
                          'h-3.5 w-3.5 transition-all',
                          watchlist.has(symbol.id) 
                            ? 'fill-warning text-warning drop-shadow-sm' 
                            : 'text-text-muted/40 group-hover:text-text-muted/60'
                        )}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-text tracking-tight">{symbol.code}</span>
                        <div className="h-1.5 w-1.5 rounded-full bg-accent shadow-sm shadow-accent/50"></div>
                      </div>
                      <PriceDisplay
                        bid={symbol.numericPrice}
                        ask={symbol.numericPrice2}
                        bidFormatted={symbol.price}
                        askFormatted={symbol.price2}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs font-semibold text-text/80">{symbol.value}</span>
                    {(symbol.change24h || 0) !== 0 && (
                      <div className={cn(
                        "flex items-center gap-0.5 px-1.5 py-0.5 rounded",
                        symbol.change24h >= 0 
                          ? "text-success bg-success/10" 
                          : "text-danger bg-danger/10"
                      )}>
                        {symbol.change24h >= 0 ? (
                          <ArrowUp className="h-2.5 w-2.5" />
                        ) : (
                          <ArrowDown className="h-2.5 w-2.5" />
                        )}
                        <span className="text-[10px] font-bold">
                          {symbol.change24h >= 0 ? '+' : ''}{symbol.change24h.toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
            )}
          </div>
        )}
      </div>

      {/* Bottom Buttons */}
      <div className="shrink-0 px-4 py-3 border-t border-white/5 bg-gradient-to-t from-white/[0.02] to-transparent">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="success"
            className="w-full h-9 text-xs font-semibold shadow-lg shadow-success/20 hover:shadow-success/30 transition-all"
            onClick={() => (onOpenDeposit ? onOpenDeposit() : setDepositModalOpen(true))}
          >
            Deposit
          </Button>
          <Button
            variant="primary"
            className="w-full h-9 text-xs font-semibold shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all"
            onClick={() => setWithdrawModalOpen(true)}
          >
            Withdraw
          </Button>
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="shrink-0 px-4 py-2.5 border-t border-white/5 space-y-0.5">
        <button
          onClick={() => {
            setChatPanelOpen(false)
            setPaymentPanelOpen(false)
            setSettingsPanelOpen(!settingsPanelOpen)
          }}
          className="w-full text-left text-xs font-medium text-text-muted/70 hover:text-text hover:bg-white/5 transition-all duration-200 rounded-lg py-2 px-2.5"
        >
          Settings
        </button>
        <button
          onClick={() => toast('Theme toggle coming soon')}
          className="w-full text-left text-xs font-medium text-text-muted/70 hover:text-text hover:bg-white/5 transition-all duration-200 rounded-lg py-2 px-2.5"
        >
          Light Theme
        </button>
        <button
          onClick={handleLogout}
          className="w-full text-left text-xs font-medium text-danger/80 hover:text-danger hover:bg-danger/10 transition-all duration-200 rounded-lg py-2 px-2.5 flex items-center gap-2"
        >
          <LogOut className="h-3.5 w-3.5" />
          Log Out
        </button>
      </div>

      {/* Deposit Modal (only when parent does not control it via onOpenDeposit) */}
      {!onOpenDeposit && (
        <DepositModal open={depositModalOpen} onOpenChange={setDepositModalOpen} />
      )}
      
      {/* Withdraw Modal */}
      <WithdrawModal open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen} />
    </div>
  )
}

