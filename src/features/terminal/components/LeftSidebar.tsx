import { Search, Grid3x3, Bell, HelpCircle, Star, ChevronDown, ChevronUp, Settings, LogOut, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Skeleton } from '@/shared/ui'
import { useTerminalStore } from '../store'
import { useAuthStore } from '@/shared/store/auth.store'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { cn } from '@/shared/utils'
import { useState, useRef, useEffect } from 'react'
import { PriceDisplay } from './PriceDisplay'

export function LeftSidebar() {
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
  } = useTerminalStore()

  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [cryptoExpanded, setCryptoExpanded] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const symbols = getFilteredSymbols()

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
            <button className="p-2 hover:bg-white/5 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 group">
              <HelpCircle className="h-4 w-4 text-text-muted group-hover:text-text transition-colors" />
            </button>
          </div>
        </div>
      </div>

      {/* Balances */}
      <div className="shrink-0 px-4 py-3.5 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-text-muted/70 uppercase tracking-wider">Balance</span>
              <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></div>
            </div>
            <div className="text-xs font-medium text-text-muted/60">USD</div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-text tracking-tight">$2,495.56</span>
            <span className="text-xs font-medium text-success">+$0.12</span>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-muted/60">Equity</span>
              <span className="text-xs font-semibold text-text/80">$2,495.68</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-muted/60">Margin</span>
              <span className="text-xs font-semibold text-text/80">$0.00</span>
            </div>
          </div>
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
            onClick={() => toast.success('Deposit feature coming soon')}
          >
            Deposit
          </Button>
          <Button
            variant="primary"
            className="w-full h-9 text-xs font-semibold shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all"
            onClick={() => toast.info('Withdraw feature coming soon')}
          >
            Withdraw
          </Button>
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="shrink-0 px-4 py-2.5 border-t border-white/5 space-y-0.5">
        <button
          onClick={() => toast.info('Settings feature coming soon')}
          className="w-full text-left text-xs font-medium text-text-muted/70 hover:text-text hover:bg-white/5 transition-all duration-200 rounded-lg py-2 px-2.5"
        >
          Settings
        </button>
        <button
          onClick={() => toast.info('Theme toggle coming soon')}
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
    </div>
  )
}

