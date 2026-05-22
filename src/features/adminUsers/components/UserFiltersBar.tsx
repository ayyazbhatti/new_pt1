import { useMemo } from 'react'
import { X, Search } from 'lucide-react'
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

  const balanceMinCh = useMemo(() => {
    const minForPlaceholder = 14
    return Math.min(20, Math.max(minForPlaceholder, filters.balanceMin.length + 10))
  }, [filters.balanceMin])

  const balanceMaxCh = useMemo(() => {
    const minForPlaceholder = 14
    return Math.min(20, Math.max(minForPlaceholder, filters.balanceMax.length + 10))
  }, [filters.balanceMax])

  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          type="search"
          placeholder="Search name, email, or user ID..."
          value={filters.search}
          onChange={(e) => handleChange('search', e.target.value)}
          className={cn('w-full min-w-0 pl-9', filters.search.trim() && 'pr-9')}
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
        <SelectTrigger className="h-10 w-fit min-w-[10.5rem] max-w-[min(100%,15rem)] shrink-0">
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
        <SelectTrigger className="h-10 w-fit min-w-[12.5rem] max-w-[min(100%,18rem)] shrink-0">
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
        <SelectTrigger className="h-10 w-fit min-w-[13.5rem] max-w-[min(100%,26rem)] shrink-0">
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
        <SelectTrigger className="h-10 w-fit min-w-[9.5rem] max-w-[min(100%,14rem)] shrink-0">
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
        className="max-w-full shrink-0 tabular-nums"
        style={{ width: `min(100%, ${balanceMinCh}ch)` }}
      />
      <Input
        type="number"
        placeholder="Max Balance"
        value={filters.balanceMax}
        onChange={(e) => handleChange('balanceMax', e.target.value)}
        className="max-w-full shrink-0 tabular-nums"
        style={{ width: `min(100%, ${balanceMaxCh}ch)` }}
      />
      <Button variant="outline" size="sm" className="shrink-0" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}
