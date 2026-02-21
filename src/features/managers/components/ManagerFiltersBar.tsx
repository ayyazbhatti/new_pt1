import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import type { Manager } from '../types/manager'

export type ManagerFilters = {
  search: string
  status: string
  permissionProfile: string
}

interface ManagerFiltersBarProps {
  filters: ManagerFilters
  onFilterChange: (filters: ManagerFilters) => void
  permissionProfileOptions: { id: string; name: string }[]
}

export function ManagerFiltersBar({
  filters,
  onFilterChange,
  permissionProfileOptions,
}: ManagerFiltersBarProps) {
  const handleChange = (field: keyof ManagerFilters, value: string) => {
    onFilterChange({ ...filters, [field]: value })
  }

  const handleClear = () => {
    onFilterChange({
      search: '',
      status: 'all',
      permissionProfile: 'all',
    })
  }

  return (
    <div className="flex items-center gap-4 flex-wrap mb-6">
      <Input
        type="search"
        placeholder="Search by name, email..."
        value={filters.search}
        onChange={(e) => handleChange('search', e.target.value)}
        className="flex-1 max-w-sm"
      />
      <Select value={filters.status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.permissionProfile}
        onValueChange={(value) => handleChange('permissionProfile', value)}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Permission profile" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All profiles</SelectItem>
          {permissionProfileOptions.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}
