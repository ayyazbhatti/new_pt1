/**
 * Short human duration from `nowMs` until `targetIso`.
 * Used for "Opens in …" / "Closes in …" badges and hints (pass `Date.now()` or a ticked clock).
 */
export function formatTimeUntil(
  targetIso: string | null | undefined,
  timezone: string | undefined,
  nowMs: number
): string {
  if (!targetIso) return ''

  const target = new Date(targetIso)
  const diffMs = target.getTime() - nowMs

  if (diffMs <= 0) return 'now'

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days >= 1) {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone && timezone.length > 0 ? timezone : 'UTC',
    }
    return target.toLocaleString(undefined, opts)
  }

  if (hours >= 1) {
    return `${hours}h ${minutes % 60}m`
  }

  if (minutes >= 1) {
    return `${minutes}m`
  }

  return `${seconds}s`
}

/** e.g. "Opens in 2h 15m" — empty when no `nextOpenAt`. */
export function formatOpensInLabel(
  nextOpenAt: string | null | undefined,
  timezone: string | undefined,
  nowMs: number
): string {
  const inner = formatTimeUntil(nextOpenAt, timezone, nowMs)
  if (!inner) return ''
  return inner === 'now' ? 'Opens now' : `Opens in ${inner}`
}

/** e.g. "Closes in 1h 30m" — empty when no `nextCloseAt`. */
export function formatClosesInLabel(
  nextCloseAt: string | null | undefined,
  timezone: string | undefined,
  nowMs: number
): string {
  const inner = formatTimeUntil(nextCloseAt, timezone, nowMs)
  if (!inner) return ''
  return inner === 'now' ? 'Closes now' : `Closes in ${inner}`
}
