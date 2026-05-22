import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { cn } from '@/shared/utils'

interface SwapFiltersBarProps {
  onFilterChange?: (filters: {
    group: string
    market: string
    symbol: string
    status: string
    calcMode: string
  }) => void
}

function hasActiveFilters(state: {
  group: string
  market: string
  symbol: string
  status: string
  calcMode: string
}) {
  return Boolean(
    state.symbol.trim() ||
      state.group !== 'all' ||
      state.market !== 'all' ||
      state.status !== 'all' ||
      state.calcMode !== 'all',
  )
}

export function SwapFiltersBar({ onFilterChange }: SwapFiltersBarProps) {
  const [group, setGroup] = useState('all')
  const [market, setMarket] = useState('all')
  const [symbol, setSymbol] = useState('')
  const [status, setStatus] = useState('all')
  const [calcMode, setCalcMode] = useState('all')
  const { data: groupsData } = useGroupsList()
  const groups = groupsData?.items ?? []

  const handleClear = () => {
    setGroup('all')
    setMarket('all')
    setSymbol('')
    setStatus('all')
    setCalcMode('all')
    onFilterChange?.({ group: 'all', market: 'all', symbol: '', status: 'all', calcMode: 'all' })
  }

  const handleChange = (field: string, value: string) => {
    const newFilters = {
      group: field === 'group' ? value : group,
      market: field === 'market' ? value : market,
      symbol: field === 'symbol' ? value : symbol,
      status: field === 'status' ? value : status,
      calcMode: field === 'calcMode' ? value : calcMode,
    }

    if (field === 'group') setGroup(value)
    if (field === 'market') setMarket(value)
    if (field === 'symbol') setSymbol(value)
    if (field === 'status') setStatus(value)
    if (field === 'calcMode') setCalcMode(value)

    onFilterChange?.(newFilters)
  }

  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          type="search"
          placeholder="Search symbols..."
          value={symbol}
          onChange={(e) => handleChange('symbol', e.target.value)}
          className={cn('w-full min-w-0 pl-9', symbol.trim() && 'pr-9')}
        />
        {symbol.trim() ? (
          <button
            type="button"
            onClick={() => handleChange('symbol', '')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <Select value={group} onValueChange={(value) => handleChange('group', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[13rem] max-w-[min(100%,26rem)] shrink-0">
          <SelectValue placeholder="Group" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={market} onValueChange={(value) => handleChange('market', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[11.5rem] max-w-[min(100%,18rem)] shrink-0">
          <SelectValue placeholder="Market" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Markets</SelectItem>
          <SelectItem value="crypto">Crypto</SelectItem>
          <SelectItem value="forex">Forex</SelectItem>
          <SelectItem value="commodities">Commodities</SelectItem>
          <SelectItem value="indices">Indices</SelectItem>
          <SelectItem value="stocks">Stocks</SelectItem>
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[10.5rem] max-w-[min(100%,15rem)] shrink-0">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <Select value={calcMode} onValueChange={(value) => handleChange('calcMode', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[11.5rem] max-w-[min(100%,18rem)] shrink-0">
          <SelectValue placeholder="Calc Mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Modes</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="hourly">Hourly</SelectItem>
          <SelectItem value="funding_8h">8H Funding</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={!hasActiveFilters({ group, market, symbol, status, calcMode })}
        onClick={handleClear}
      >
        Clear
      </Button>
    </div>
  )
}
