import { format, subDays } from 'date-fns'

export type DateRangePreset = '7' | '30' | '90' | 'custom'

export function formatDateInput(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function rangeForPreset(preset: Exclude<DateRangePreset, 'custom'>): {
  dateFrom: string
  dateTo: string
} {
  const dateTo = new Date()
  const days = preset === '7' ? 7 : preset === '90' ? 90 : 30
  const dateFrom = subDays(dateTo, days)
  return {
    dateFrom: formatDateInput(dateFrom),
    dateTo: formatDateInput(dateTo),
  }
}

export function defaultUserEventFilters(userId = ''): {
  search: string
  category: string
  eventType: string
  deviceClass: string
  userId: string
  datePreset: DateRangePreset
  dateFrom: string
  dateTo: string
} {
  const { dateFrom, dateTo } = rangeForPreset('30')
  return {
    search: '',
    category: 'all',
    eventType: 'all',
    deviceClass: 'all',
    userId,
    datePreset: '30',
    dateFrom,
    dateTo,
  }
}

/** RFC3339 start of day UTC for API `from`. */
export function toApiFrom(date: string): string | undefined {
  if (!date.trim()) return undefined
  return `${date.trim()}T00:00:00.000Z`
}

/** RFC3339 end of day UTC for API `to`. */
export function toApiTo(date: string): string | undefined {
  if (!date.trim()) return undefined
  return `${date.trim()}T23:59:59.999Z`
}
