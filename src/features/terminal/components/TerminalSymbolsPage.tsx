import { useRef, useState } from 'react'
import { Menu, X, Search, Star } from 'lucide-react'
import { useTerminalStore } from '../store/terminalStore'
import { Input } from '@/shared/ui'
import { Skeleton } from '@/shared/ui'
import { PriceDisplay } from './PriceDisplay'
import { cn } from '@/shared/utils'
import { toast } from '@/shared/components/common'
import { updateTerminalPreferences } from '../api/preferences.api'

const QUOTE_CATEGORIES = [
  { id: 'all' as const, label: 'All' },
  { id: 'crypto' as const, label: 'Cryptocurrencies' },
  { id: 'watchlist' as const, label: 'Favourite' },
] as const

type QuoteCategoryId = (typeof QUOTE_CATEGORIES)[number]['id']

interface TerminalSymbolsPageProps {
  onClose: () => void
  /** Called when hamburger (top-left) is clicked; navigates to Account tab. */
  onOpenMenu: () => void
}

/**
 * Full-screen Quotes page (symbol live prices), matching reference layout:
 * Header with "Quotes" title, search; category pills; two-column symbol list.
 */
export function TerminalSymbolsPage({ onClose, onOpenMenu }: TerminalSymbolsPageProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<QuoteCategoryId>('all')
  const [searchOpen, setSearchOpen] = useState(false)

  const {
    getFilteredSymbols,
    symbols: allSymbols,
    setSelectedSymbol,
    setSearchQuery,
    searchQuery,
    setActiveTab,
    watchlist,
    toggleWatchlist,
    selectedSymbol,
    isLoading,
  } = useTerminalStore()

  // Sync category with store tabs: "watchlist" -> watchlists, else all
  const applyCategory = (cat: QuoteCategoryId) => {
    setCategory(cat)
    setActiveTab(cat === 'watchlist' ? 'watchlists' : 'all')
  }

  const symbols = getFilteredSymbols()
  const totalCount = allSymbols.length
  const watchlistCount = watchlist.size

  return (
    <div className="h-full min-h-[100dvh] w-full flex flex-col bg-background">
      {/* Header: left = hamburger (menu), center = title, right = search */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-3 border-b border-white/10">
        <button
          type="button"
          onClick={onOpenMenu}
          className="p-2 -ml-1 rounded-lg hover:bg-white/10 text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-center text-lg font-semibold text-text">
          Quotes
        </h1>
        <div className="flex items-center justify-end min-w-[44px]">
          <button
            type="button"
            onClick={() => {
              setSearchOpen((o) => !o)
              if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50)
            }}
            className="p-2.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Search bar (expand when search icon tapped) */}
      {searchOpen && (
        <div className="shrink-0 px-4 py-2 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/60 pointer-events-none" />
            <Input
              ref={searchInputRef}
              placeholder="Search symbols..."
              className={cn(
                'pl-9 h-10 text-sm bg-white/5 border-white/10 focus:bg-white/10 focus:border-accent/50',
                searchQuery && 'pr-9'
              )}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text hover:bg-white/10"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Category filter: horizontally scrollable pills */}
      <div className="shrink-0 border-b border-white/10 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-2 px-4 py-3 min-w-max">
          {QUOTE_CATEGORIES.map((cat) => {
            const count =
              cat.id === 'watchlist'
                ? watchlistCount
                : cat.id === 'all'
                  ? totalCount
                  : totalCount
            const isSelected = category === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => applyCategory(cat.id)}
                className={cn(
                  'shrink-0 px-4 py-2.5 rounded-full text-sm font-semibold border transition-all',
                  isSelected
                    ? 'bg-accent/20 text-text border-accent text-white'
                    : 'bg-white/5 text-text-muted border-white/10 hover:bg-white/10 hover:text-text'
                )}
              >
                {cat.label}
                {cat.id !== 'watchlist' && ` (${count})`}
                {cat.id === 'watchlist' && ` (${watchlistCount})`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Symbol list: two columns — symbol (left), bid/ask (right) with color */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="px-4 py-3 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : symbols.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No symbols match.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {symbols.map((symbol) => (
              <li
                key={symbol.id}
                className={cn(
                  'flex items-center w-full px-4 py-3.5 gap-2 hover:bg-white/5 active:bg-white/10 transition-colors',
                  selectedSymbol?.id === symbol.id && 'bg-accent/10'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    const wasInList = watchlist.has(symbol.id)
                    toggleWatchlist(symbol.id)
                    const nextIds = Array.from(useTerminalStore.getState().watchlist)
                    updateTerminalPreferences({ favouriteSymbolIds: nextIds }).catch(() =>
                      toast.error('Failed to save favourites')
                    )
                    toast.success(wasInList ? 'Removed from favourites' : 'Added to favourites')
                  }}
                  className="p-1.5 shrink-0 rounded-lg hover:bg-white/10 active:scale-95 transition-all"
                  aria-label={watchlist.has(symbol.id) ? 'Remove from favourites' : 'Add to favourites'}
                >
                  <Star
                    className={cn(
                      'h-4 w-4 transition-all',
                      watchlist.has(symbol.id)
                        ? 'fill-warning text-warning'
                        : 'text-text-muted/50'
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSymbol(symbol)
                    onClose()
                  }}
                  className="flex-1 flex items-center justify-between gap-3 min-w-0 text-left"
                >
                  <span className="text-sm font-bold text-text truncate">
                    {symbol.code}
                  </span>
                  <div className="shrink-0">
                    <PriceDisplay
                      bid={symbol.numericPrice ?? 0}
                      ask={symbol.numericPrice2 ?? 0}
                      bidFormatted={symbol.price}
                      askFormatted={symbol.price2}
                      className="text-sm font-semibold"
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
