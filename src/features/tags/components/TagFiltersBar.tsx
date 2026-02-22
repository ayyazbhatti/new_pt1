import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Search } from 'lucide-react'

export type TagFilters = {
  search: string
}

interface TagFiltersBarProps {
  filters: TagFilters
  onFilterChange: (filters: TagFilters) => void
}

export function TagFiltersBar({ filters, onFilterChange }: TagFiltersBarProps) {
  const handleChange = (field: keyof TagFilters, value: string) => {
    onFilterChange({ ...filters, [field]: value })
  }

  const handleClear = () => {
    onFilterChange({ search: '' })
  }

  return (
    <div className="flex items-center gap-4 flex-wrap mb-6">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <Input
          type="search"
          placeholder="Search by name or slug..."
          value={filters.search}
          onChange={(e) => handleChange('search', e.target.value)}
          className="pl-9"
        />
      </div>
      <Button variant="outline" size="sm" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}
