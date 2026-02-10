import { Search, Grid3x3, Bell, HelpCircle, Star, ChevronDown, ChevronUp, Settings, LogOut, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Skeleton } from '@/shared/ui'
import { useTerminalStore } from '../store'
import { useAuthStore } from '@/shared/store/auth.store'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { cn } from '@/shared/utils'
import { useState } from 'react'

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
  const symbols = getFilteredSymbols()

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
    <div className="h-full min-h-0 overflow-hidden bg-gradient-to-b from-[#0f172a] to-[#0b1220] flex flex-col">
      {/* Top User Row */}
      <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center text-white font-semibold text-sm">
          {getUserInitials()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text truncate">{getUserDisplayName()}</div>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1.5 hover:bg-surface-2 rounded transition-colors">
            <Grid3x3 className="h-4 w-4 text-text-dim" />
          </button>
          <button className="p-1.5 hover:bg-surface-2 rounded transition-colors">
            <Bell className="h-4 w-4 text-text-dim" />
          </button>
          <button className="p-1.5 hover:bg-surface-2 rounded transition-colors">
            <HelpCircle className="h-4 w-4 text-text-dim" />
          </button>
        </div>
      </div>

      {/* Balances */}
      <div className="shrink-0 p-4 border-b border-border">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="text-xs text-text-muted">Current Balance</div>
            <div className="h-2 w-2 rounded-full bg-success"></div>
            <div className="text-sm font-bold text-text">$2,495.56</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-text-muted">Equity</div>
            <div className="text-sm text-text">$2,495.68</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <Input
            placeholder="Q Search symbol..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-4 pt-2 pb-3 border-b border-border flex items-center gap-2">
        <button
          onClick={() => setActiveTab('all')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            activeTab === 'all'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text'
          )}
        >
          All Symbols (9)
        </button>
        <button
          onClick={() => setActiveTab('watchlists')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5',
            activeTab === 'watchlists'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text'
          )}
        >
          Watchlists
          <span className="h-1.5 w-1.5 rounded-full bg-success"></span>
          <span className="text-success text-xs">Live</span>
        </button>
      </div>

      {/* Section Header */}
      <button
        onClick={() => setCryptoExpanded(!cryptoExpanded)}
        className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between w-full hover:bg-surface-2/30 transition-colors"
      >
        <div className="text-xs font-semibold text-text uppercase">Cryptocurrencies</div>
        {cryptoExpanded ? (
          <ChevronUp className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}
      </button>

      {/* Symbols List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {cryptoExpanded && (
          <div className="h-full overflow-y-auto scrollbar-thin">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Skeleton className="h-4 w-4 rounded-full" variant="circular" />
                    <Skeleton className="h-4 w-20" variant="text" />
                    <Skeleton className="h-4 w-12 ml-auto" variant="text" />
                  </div>
                  <Skeleton className="h-3 w-24" variant="text" />
                </div>
              ))
            ) : (
              symbols.map((symbol) => (
              <div
                key={symbol.id}
                onClick={() => setSelectedSymbol(symbol)}
                className={cn(
                  'px-4 py-3 border-b border-border hover:bg-surface-2/50 transition-colors cursor-pointer',
                  selectedSymbol.id === symbol.id && 'bg-surface-2/30'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleWatchlist(symbol.id)
                      toast.success(watchlist.has(symbol.id) ? 'Removed from watchlist' : 'Added to watchlist')
                    }}
                    className="p-0.5 hover:bg-surface-2/50 rounded transition-colors"
                  >
                    <Star
                      className={cn(
                        'h-3.5 w-3.5',
                        watchlist.has(symbol.id) ? 'fill-warning text-warning' : 'text-muted'
                      )}
                    />
                  </button>
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-sm font-medium text-text">{symbol.code}</span>
                    <div className="h-1.5 w-1.5 rounded-full bg-accent"></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">{symbol.value}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className={cn(
                    "text-xs",
                    (symbol.change24h || 0) >= 0 ? "text-success" : "text-danger"
                  )}>{symbol.price}</span>
                  <span className="text-xs text-text-muted">/</span>
                  <span className={cn(
                    "text-xs",
                    (symbol.change24h || 0) >= 0 ? "text-success" : "text-danger"
                  )}>{symbol.price2}</span>
                  {(symbol.change24h || 0) !== 0 && (
                    <div className={cn(
                      "flex items-center gap-0.5 ml-1",
                      symbol.change24h >= 0 ? "text-success" : "text-danger"
                    )}>
                      {symbol.change24h >= 0 ? (
                        <ArrowUp className="h-2.5 w-2.5" />
                      ) : (
                        <ArrowDown className="h-2.5 w-2.5" />
                      )}
                      <span className="text-xs font-medium">
                        {symbol.change24h >= 0 ? '+' : ''}{symbol.change24h.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))
            )}
          </div>
        )}
      </div>

      {/* Bottom Buttons */}
      <div className="shrink-0 p-4 border-t border-border grid grid-cols-2 gap-2">
        <Button
          variant="success"
          className="w-full"
          onClick={() => toast.success('Deposit feature coming soon')}
        >
          Deposit
        </Button>
        <Button
          variant="primary"
          className="w-full"
          onClick={() => toast.info('Withdraw feature coming soon')}
        >
          Withdraw
        </Button>
      </div>

      {/* Bottom Nav */}
      <div className="shrink-0 p-4 border-t border-border space-y-2">
        <button
          onClick={() => toast.info('Settings feature coming soon')}
          className="w-full text-left text-xs text-text-muted hover:text-text transition-colors py-1.5"
        >
          Settings
        </button>
        <button
          onClick={() => toast.info('Theme toggle coming soon')}
          className="w-full text-left text-xs text-text-muted hover:text-text transition-colors py-1.5"
        >
          Light Theme
        </button>
        <button
          onClick={handleLogout}
          className="w-full text-left text-xs text-danger hover:text-danger/80 transition-colors py-1.5 flex items-center gap-2"
        >
          <LogOut className="h-3.5 w-3.5" />
          Log Out
        </button>
      </div>
    </div>
  )
}

