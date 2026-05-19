import { X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'
import type { UserFilters } from '../types/users'

interface UserFiltersBarProps {
  filters: UserFilters
  onFilterChange: (filters: UserFilters) => void
  /** Groups for the Group dropdown (from API). When empty, only "All Groups" is shown. */
  groups?: { id: string; name: string }[]
}

const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'SG', 'FR', 'IT', 'ES', 'NL']

export function UserFiltersBar({ filters, onFilterChange, groups = [] }: UserFiltersBarProps) {
  const handleChange = (field: keyof typeof filters, value: string) => {
    onFilterChange({ ...filters, [field]: value })
  }

  const handleClear = () => {
    onFilterChange({
      search: '',
      status: 'all',
      kycStatus: 'all',
      group: 'all',
      country: 'all',
      balanceMin: '',
      balanceMax: '',
    })
  }

  return (
    <div className="flex items-center gap-4 flex-wrap mb-6">
      <div className="relative flex-1 max-w-sm">
        <Input
          type="search"
          placeholder="Search name, email, or user ID..."
          value={filters.search}
          onChange={(e) => handleChange('search', e.target.value)}
          className={cn('w-full', filters.search.trim() && 'pr-9')}
        />
        {filters.search.trim() ? (
          <button
            type="button"
            onClick={() => handleChange('search', '')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <Select value={filters.status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.kycStatus} onValueChange={(value) => handleChange('kycStatus', value)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="KYC Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="none">Not Submitted</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="verified">Verified</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.group} onValueChange={(value) => handleChange('group', value)}>
        <SelectTrigger className="w-[180px]">
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
      <Select value={filters.country} onValueChange={(value) => handleChange('country', value)}>
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Country" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {countries.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        placeholder="Min Balance"
        value={filters.balanceMin}
        onChange={(e) => handleChange('balanceMin', e.target.value)}
        className="w-[130px]"
      />
      <Input
        type="number"
        placeholder="Max Balance"
        value={filters.balanceMax}
        onChange={(e) => handleChange('balanceMax', e.target.value)}
        className="w-[130px]"
      />
      <Button variant="outline" size="sm" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}

