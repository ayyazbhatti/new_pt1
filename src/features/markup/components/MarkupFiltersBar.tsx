import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { mockGroups } from '@/features/groups/mocks/groups.mock'

interface MarkupFiltersBarProps {
  onFilterChange?: (filters: {
    group: string
    market: string
    symbol: string
    status: string
  }) => void
}

export function MarkupFiltersBar({ onFilterChange }: MarkupFiltersBarProps) {
  const [group, setGroup] = useState('all')
  const [market, setMarket] = useState('all')
  const [symbol, setSymbol] = useState('')
  const [status, setStatus] = useState('all')

  const handleClear = () => {
    setGroup('all')
    setMarket('all')
    setSymbol('')
    setStatus('all')
    onFilterChange?.({ group: 'all', market: 'all', symbol: '', status: 'all' })
  }

  const handleChange = (field: string, value: string) => {
    const newFilters = {
      group: field === 'group' ? value : group,
      market: field === 'market' ? value : market,
      symbol: field === 'symbol' ? value : symbol,
      status: field === 'status' ? value : status,
    }

    if (field === 'group') setGroup(value)
    if (field === 'market') setMarket(value)
    if (field === 'symbol') setSymbol(value)
    if (field === 'status') setStatus(value)

    onFilterChange?.(newFilters)
  }

  return (
    <div className="flex items-center gap-4 mb-6">
      <Select value={group} onValueChange={(value) => handleChange('group', value)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Group" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          {mockGroups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={market} onValueChange={(value) => handleChange('market', value)}>
        <SelectTrigger className="w-[180px]">
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
      <div className="flex-1 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search symbols..."
            value={symbol}
            onChange={(e) => handleChange('symbol', e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <Select value={status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={handleClear}>
        <X className="h-4 w-4 mr-2" />
        Clear
      </Button>
    </div>
  )
}

