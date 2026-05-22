import { useMemo } from 'react'
import { X, Search } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'
import type { UserEventFilters } from '../types'
import { DEVICE_CLASSES, EVENT_CATEGORIES } from '../types'
import {
  defaultUserEventFilters,
  rangeForPreset,
  type DateRangePreset,
} from '../utils/dateRange'

const AUTH_EVENT_TYPES = [
  { value: 'all', label: 'All auth events' },
  { value: 'auth.register', label: 'Registered' },
  { value: 'auth.login', label: 'Logged in' },
  { value: 'auth.logout', label: 'Logged out' },
]

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
]

interface UserEventsFiltersBarProps {
  filters: UserEventFilters
  onFilterChange: (filters: UserEventFilters) => void
}

export function UserEventsFiltersBar({ filters, onFilterChange }: UserEventsFiltersBarProps) {
  const handleChange = (field: keyof UserEventFilters, value: string) => {
    onFilterChange({ ...filters, [field]: value })
  }

  const handlePresetChange = (preset: DateRangePreset) => {
    if (preset === 'custom') {
      onFilterChange({ ...filters, datePreset: preset })
      return
    }
    const range = rangeForPreset(preset)
    onFilterChange({
      ...filters,
      datePreset: preset,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    })
  }

  const handleClear = () => {
    onFilterChange(defaultUserEventFilters())
  }

  /** `ch`-based width so the field grows with typed text; capped so the bar wraps instead of scrolling. */
  const searchWidthCh = useMemo(() => {
    const minForPlaceholder = 34
    const clearPad = filters.search.trim() ? 4 : 0
    return Math.min(58, Math.max(minForPlaceholder, filters.search.length + 24 + clearPad))
  }, [filters.search])

  const userIdWidthCh = useMemo(() => {
    const minForPlaceholder = 18
    return Math.min(46, Math.max(minForPlaceholder, filters.userId.length + 10))
  }, [filters.userId])

  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      <div
        className="relative max-w-full shrink-0"
        style={{ width: `min(100%, ${searchWidthCh}ch)` }}
      >
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted pointer-events-none" />
        <Input
          type="search"
          placeholder="Search user, email, or event..."
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
      <Select value={filters.category} onValueChange={(value) => handleChange('category', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[9.5rem] max-w-[min(100%,18rem)] shrink-0">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {EVENT_CATEGORIES.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.eventType} onValueChange={(value) => handleChange('eventType', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[11rem] max-w-[min(100%,20rem)] shrink-0">
          <SelectValue placeholder="Event type" />
        </SelectTrigger>
        <SelectContent>
          {AUTH_EVENT_TYPES.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.deviceClass} onValueChange={(value) => handleChange('deviceClass', value)}>
        <SelectTrigger className="h-10 w-fit min-w-[8.5rem] max-w-[min(100%,16rem)] shrink-0">
          <SelectValue placeholder="Device" />
        </SelectTrigger>
        <SelectContent>
          {DEVICE_CLASSES.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        placeholder="User ID (optional)"
        value={filters.userId}
        onChange={(e) => handleChange('userId', e.target.value)}
        className="max-w-full shrink-0 font-mono text-xs"
        style={{ width: `min(100%, ${userIdWidthCh}ch)` }}
      />
      <Select value={filters.datePreset} onValueChange={(v) => handlePresetChange(v as DateRangePreset)}>
        <SelectTrigger className="h-10 w-fit min-w-[9rem] max-w-[min(100%,14rem)] shrink-0">
          <SelectValue placeholder="Date range" />
        </SelectTrigger>
        <SelectContent>
          {DATE_PRESETS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex shrink-0 items-center gap-2">
        <label className="text-xs text-text-muted whitespace-nowrap">From</label>
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) =>
            onFilterChange({
              ...filters,
              datePreset: 'custom',
              dateFrom: e.target.value,
            })
          }
          disabled={filters.datePreset !== 'custom'}
          className="w-auto min-w-[10.5rem] shrink-0"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="text-xs text-text-muted whitespace-nowrap">To</label>
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) =>
            onFilterChange({
              ...filters,
              datePreset: 'custom',
              dateTo: e.target.value,
            })
          }
          disabled={filters.datePreset !== 'custom'}
          className="w-auto min-w-[10.5rem] shrink-0"
        />
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={handleClear}>
        Clear all
      </Button>
    </div>
  )
}
