import type { IanaTimezone } from './types'

export type DateInput = string | number | Date

function toDate(input: DateInput): Date | null {
  if (input == null || input === '') return null
  const d = input instanceof Date ? input : new Date(input)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Full date + time, e.g. "21 May 2026, 14:32" */
export function formatDateTime(input: DateInput, timezone: IanaTimezone): string {
  const d = toDate(input)
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** Date only, e.g. "21 May 2026" */
export function formatDate(input: DateInput, timezone: IanaTimezone): string {
  const d = toDate(input)
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d)
}

/** Time only, e.g. "14:32" */
export function formatTime(input: DateInput, timezone: IanaTimezone): string {
  const d = toDate(input)
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(d)
}

/** Full date + time + seconds, e.g. "21 May 2026, 14:32:08" */
export function formatDateTimeSeconds(input: DateInput, timezone: IanaTimezone): string {
  const d = toDate(input)
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(d)
}

/** Relative ("3m ago", "2h ago", "yesterday", or fallback to date) */
export function formatRelative(input: DateInput, timezone: IanaTimezone, now: Date = new Date()): string {
  const d = toDate(input)
  if (!d) return '—'
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`
  return formatDate(d, timezone)
}

/**
 * Get the offset (in minutes) for the given timezone at the given instant:
 * minutes to add to UTC instant `at` to align with the wall-clock shown in `timezone` for that instant.
 */
function getUtcOffsetLabelMinutes(timezone: IanaTimezone, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(at)
  const lookup: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') lookup[p.type] = p.value
  }
  const asUTC = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  )
  return (asUTC - at.getTime()) / 60_000
}

/**
 * Parse a Date input that represents wall-clock time in a SPECIFIC timezone
 * (used for appointment forms where admin types times in user's timezone).
 * Returns a UTC Date object suitable for storage.
 */
/** Calendar + clock components for an instant when shown in `timezone` (for appointment forms). */
export function wallClockPartsInTimezone(
  input: DateInput,
  timezone: IanaTimezone,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const d = toDate(input)
  if (!d) return null
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(d)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  const year = Number(map.year)
  const month = Number(map.month)
  const day = Number(map.day)
  const hour = Number(map.hour)
  const minute = Number(map.minute)
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null
  return { year, month, day, hour, minute }
}

export function fromZonedWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: IanaTimezone,
): Date {
  // Strategy: construct a UTC date with the given fields, then find the offset
  // for that moment in the target timezone, and subtract it to get the true UTC instant.
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offsetMinutes = getUtcOffsetLabelMinutes(timezone, naiveUtc)
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000)
}
