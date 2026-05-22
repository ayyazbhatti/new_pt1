import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
import { SearchableFilterDropdown } from './SearchableFilterDropdown'
import type { LookupGroup, LookupSymbol, TabListQuery } from '../types'

interface TradingTabToolbarProps {
  query: TabListQuery
  onQueryChange: (query: TabListQuery) => void
  symbols: LookupSymbol[]
  groups: LookupGroup[]
  lookupsLoading?: boolean
}

function hasActiveQuery(query: TabListQuery) {
  return Boolean(query.search?.trim() || query.symbol || query.groupId)
}

export function TradingTabToolbar({
  query,
  onQueryChange,
  symbols,
  groups,
  lookupsLoading,
}: TradingTabToolbarProps) {
  const [searchInput, setSearchInput] = useState(query.search ?? '')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false)
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false)

  const symbolOptions = useMemo(
    () => symbols.map((s) => ({ value: s.code, label: s.code })),
    [symbols]
  )
  const groupOptions = useMemo(
    () => groups.map((g) => ({ value: g.id, label: g.name })),
    [groups]
  )

  useEffect(() => {
    setSearchInput(query.search ?? '')
  }, [query.search])

  useEffect(() => {
    const nextSearch = debouncedSearch.trim() || undefined
    if (nextSearch === (query.search ?? undefined)) return
    onQueryChange({
      symbol: query.symbol,
      groupId: query.groupId,
      search: nextSearch,
    })
  }, [debouncedSearch, onQueryChange, query.search, query.symbol, query.groupId])

  const clearAll = () => {
    setSearchInput('')
    onQueryChange({})
  }

  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          type="search"
          placeholder="Search user, email, symbol…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={cn('w-full min-w-0 pl-9', searchInput.trim() && 'pr-9')}
        />
        {searchInput.trim() ? (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <SearchableFilterDropdown
        value={query.symbol}
        onChange={(symbol) =>
          onQueryChange({
            search: query.search,
            groupId: query.groupId,
            symbol,
          })
        }
        options={symbolOptions}
        allLabel="All symbols"
        searchPlaceholder="Search symbols…"
        disabled={lookupsLoading}
        open={symbolDropdownOpen}
        onOpenChange={(open) => {
          setSymbolDropdownOpen(open)
          if (open) setGroupDropdownOpen(false)
        }}
        className="min-w-[10.5rem] max-w-[min(100%,18rem)]"
      />

      <SearchableFilterDropdown
        value={query.groupId}
        onChange={(groupId) =>
          onQueryChange({
            search: query.search,
            symbol: query.symbol,
            groupId,
          })
        }
        options={groupOptions}
        allLabel="All groups"
        searchPlaceholder="Search groups…"
        disabled={lookupsLoading}
        open={groupDropdownOpen}
        onOpenChange={(open) => {
          setGroupDropdownOpen(open)
          if (open) setSymbolDropdownOpen(false)
        }}
        className="min-w-[13rem] max-w-[min(100%,26rem)]"
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={!hasActiveQuery(query)}
        onClick={clearAll}
      >
        Clear
      </Button>
    </div>
  )
}
