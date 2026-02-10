import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Search, X } from 'lucide-react'
import { useState } from 'react'

interface SymbolsFiltersProps {
  onFilterChange?: (filters: {
    search: string
    market: string
    status: string
  }) => void
}

export function SymbolsFilters({ onFilterChange }: SymbolsFiltersProps) {
  const [search, setSearch] = useState('')
  const [market, setMarket] = useState('all')
  const [status, setStatus] = useState('all')

  const handleClear = () => {
    setSearch('')
    setMarket('all')
    setStatus('all')
    onFilterChange?.({ search: '', market: 'all', status: 'all' })
  }

  const handleChange = (field: string, value: string) => {
    const newFilters = {
      search: field === 'search' ? value : search,
      market: field === 'market' ? value : market,
      status: field === 'status' ? value : status,
    }

    if (field === 'search') setSearch(value)
    if (field === 'market') setMarket(value)
    if (field === 'status') setStatus(value)

    onFilterChange?.(newFilters)
  }

  return (
    <div className="flex items-center gap-4 mb-6">
      <div className="flex-1 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search symbols..."
            value={search}
            onChange={(e) => handleChange('search', e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <Select value={market} onValueChange={(value) => handleChange('market', value)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Market" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Markets</SelectItem>
          <SelectItem value="crypto">Crypto</SelectItem>
          <SelectItem value="forex">Forex</SelectItem>
          <SelectItem value="metals">Metals</SelectItem>
          <SelectItem value="indices">Indices</SelectItem>
          <SelectItem value="stocks">Stocks</SelectItem>
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="enabled">Enabled</SelectItem>
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

