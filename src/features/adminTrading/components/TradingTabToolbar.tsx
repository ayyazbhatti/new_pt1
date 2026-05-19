import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
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
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-1 p-3">
      <span className="relative block min-w-[200px] max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          placeholder="Search user, email, symbol…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </span>

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
      />

      {hasActiveQuery(query) && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          <X className="mr-1 h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
