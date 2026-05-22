import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Search, X } from 'lucide-react'
import { cn } from '@/shared/utils'

interface SymbolsFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  assetClass: string
  isEnabled: string
  onFilterChange: (key: string, value: string) => void
}

function hasActiveFilters(search: string, assetClass: string, isEnabled: string) {
  return Boolean(
    search.trim() || (assetClass && assetClass !== 'all') || (isEnabled && isEnabled !== 'all'),
  )
}

export function SymbolsFilters({
  search,
  onSearchChange,
  assetClass,
  isEnabled,
  onFilterChange,
}: SymbolsFiltersProps) {
  const handleClear = () => {
    onSearchChange('')
    onFilterChange('asset_class', 'all')
    onFilterChange('is_enabled', 'all')
  }

  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          type="search"
          placeholder="Search symbols..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={cn('w-full min-w-0 pl-9', search.trim() && 'pr-9')}
        />
        {search.trim() ? (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <Select value={assetClass} onValueChange={(value) => onFilterChange('asset_class', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[11.5rem] max-w-[min(100%,18rem)] shrink-0">
          <SelectValue placeholder="Asset Class" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Classes</SelectItem>
          <SelectItem value="FX">FX</SelectItem>
          <SelectItem value="Crypto">Crypto</SelectItem>
          <SelectItem value="Metals">Metals</SelectItem>
          <SelectItem value="Indices">Indices</SelectItem>
          <SelectItem value="Stocks">Stocks</SelectItem>
          <SelectItem value="Commodities">Commodities</SelectItem>
        </SelectContent>
      </Select>
      <Select value={isEnabled} onValueChange={(value) => onFilterChange('is_enabled', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[10.5rem] max-w-[min(100%,15rem)] shrink-0">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="true">Enabled</SelectItem>
          <SelectItem value="false">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={!hasActiveFilters(search, assetClass, isEnabled)}
        onClick={handleClear}
      >
        Clear
      </Button>
    </div>
  )
}
