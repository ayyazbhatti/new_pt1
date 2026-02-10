import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Search, X } from 'lucide-react'

interface SymbolsFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  assetClass: string
  isEnabled: string
  onFilterChange: (key: string, value: string) => void
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
    <div className="flex items-center gap-4 mb-6">
      <div className="flex-1 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search symbols..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <Select value={assetClass} onValueChange={(value) => onFilterChange('asset_class', value)}>
        <SelectTrigger className="w-[180px]">
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
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="true">Enabled</SelectItem>
          <SelectItem value="false">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={handleClear}>
        <X className="h-4 w-4 mr-2" />
        Clear
      </Button>
    </div>
  )
}

