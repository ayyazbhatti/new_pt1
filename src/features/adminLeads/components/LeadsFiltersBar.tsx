import { Search, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'
import type { LeadStatus, LeadSource } from '../types/leads'
import { LEAD_STATUS_LABELS, LEAD_SOURCE_LABELS } from '../types/leads'

export type LeadFilters = {
  search: string
  status: string
  source: string
}

const STATUS_OPTIONS: LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'proposal_sent',
  'negotiation',
  'converted',
  'lost',
]
const SOURCE_OPTIONS: LeadSource[] = [
  'website',
  'landing_page',
  'demo_request',
  'chat',
  'google_ad',
  'meta_ad',
  'referral',
  'event',
  'other',
]

interface LeadsFiltersBarProps {
  filters: LeadFilters
  onFilterChange: (filters: LeadFilters) => void
}

function hasActiveFilters(filters: LeadFilters) {
  return (
    filters.search.trim() !== '' || filters.status !== 'all' || filters.source !== 'all'
  )
}

export function LeadsFiltersBar({ filters, onFilterChange }: LeadsFiltersBarProps) {
  const handleChange = (field: keyof LeadFilters, value: string) => {
    onFilterChange({ ...filters, [field]: value })
  }

  const handleClear = () => {
    onFilterChange({
      search: '',
      status: 'all',
      source: 'all',
    })
  }

  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      <div className="relative min-h-10 min-w-[min(100%,220px)] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          type="search"
          placeholder="Search name, email, or company…"
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
        <SelectTrigger className="h-10 w-fit min-w-[11.5rem] max-w-[min(100%,18rem)] shrink-0">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.source} onValueChange={(value) => handleChange('source', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[12.5rem] max-w-[min(100%,20rem)] shrink-0">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {SOURCE_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {LEAD_SOURCE_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={!hasActiveFilters(filters)}
        onClick={handleClear}
      >
        Clear
      </Button>
    </div>
  )
}
