import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import type { LeadStatus, LeadSource } from '../types/leads'
import { LEAD_STATUS_LABELS, LEAD_SOURCE_LABELS } from '../types/leads'

export type LeadFilters = {
  search: string
  status: string
  source: string
}

const STATUS_OPTIONS: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'converted', 'lost']
const SOURCE_OPTIONS: LeadSource[] = ['website', 'landing_page', 'demo_request', 'chat', 'google_ad', 'meta_ad', 'referral', 'event', 'other']

interface LeadsFiltersBarProps {
  filters: LeadFilters
  onFilterChange: (filters: LeadFilters) => void
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
    <div className="flex items-center gap-4 flex-wrap mb-6">
      <Input
        type="search"
        placeholder="Search name, email, or company..."
        value={filters.search}
        onChange={(e) => handleChange('search', e.target.value)}
        className="flex-1 max-w-sm"
      />
      <Select value={filters.status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="w-[150px]">
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
        <SelectTrigger className="w-[180px]">
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
      <Button variant="outline" size="sm" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}
