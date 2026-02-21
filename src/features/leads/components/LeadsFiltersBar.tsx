import { useMemo, useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { useLeadStages } from '../hooks/useLeadStages'
import { mockUsers } from '../api/leads.mock'
import type { LeadStatus } from '../types/leads.types'
import { cn } from '@/shared/utils'

export interface LeadsFiltersState {
  search?: string
  status?: LeadStatus
  stageId?: string
  ownerUserId?: string
  source?: string
  country?: string
  scoreMin?: number
  scoreMax?: number
}

interface LeadsFiltersBarProps {
  filters: LeadsFiltersState
  onFiltersChange: (f: LeadsFiltersState) => void
  className?: string
}

const statusOptions: { value: LeadStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
  { value: 'junk', label: 'Junk' },
]

export function LeadsFiltersBar({ filters, onFiltersChange, className }: LeadsFiltersBarProps) {
  const [localSearch, setLocalSearch] = useState(filters.search ?? '')
  const { data: stages } = useLeadStages()

  const handleSearchSubmit = () => {
    onFiltersChange({ ...filters, search: localSearch || undefined })
  }

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.search ||
      filters.status ||
      filters.stageId ||
      filters.ownerUserId ||
      filters.source ||
      filters.country ||
      filters.scoreMin != null ||
      filters.scoreMax != null
    )
  }, [filters])

  const clearFilters = () => {
    setLocalSearch('')
    onFiltersChange({})
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
        <Input
          placeholder="Search name, email, phone..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
          className="max-w-xs"
        />
        <Button variant="secondary" size="sm" onClick={handleSearchSubmit}>
          Search
        </Button>
      </div>
      <Select
        value={filters.status ?? 'all'}
        onValueChange={(v) => onFiltersChange({ ...filters, status: v === 'all' ? undefined : (v as LeadStatus) })}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All status</SelectItem>
          {statusOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.stageId ?? 'all'}
        onValueChange={(v) => onFiltersChange({ ...filters, stageId: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Stage" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All stages</SelectItem>
          {(stages ?? []).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.ownerUserId ?? 'all'}
        onValueChange={(v) => onFiltersChange({ ...filters, ownerUserId: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Owner" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All owners</SelectItem>
          {mockUsers.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  )
}
