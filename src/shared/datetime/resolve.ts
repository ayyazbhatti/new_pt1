import type { IanaTimezone, ResolvedTimezone, TimezoneSource } from './types'

const FALLBACK_TIMEZONE: IanaTimezone = 'UTC'

/** Validate an IANA string by attempting to use it with Intl.DateTimeFormat */
export function isValidIanaTimezone(tz: string | null | undefined): tz is IanaTimezone {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Resolution priority:
 *   1. userTimezone (if valid)
 *   2. groupTimezone (if valid)
 *   3. platformTimezone (if valid)
 *   4. 'UTC' fallback
 */
export function resolveEffectiveTimezone(source: TimezoneSource): ResolvedTimezone {
  if (isValidIanaTimezone(source.userTimezone)) {
    return { iana: source.userTimezone, origin: 'user' }
  }
  if (isValidIanaTimezone(source.groupTimezone)) {
    return { iana: source.groupTimezone, origin: 'group' }
  }
  if (isValidIanaTimezone(source.platformTimezone)) {
    return { iana: source.platformTimezone, origin: 'platform' }
  }
  return { iana: FALLBACK_TIMEZONE, origin: 'fallback' }
}

/**
 * Compute the UTC offset string (e.g. "UTC+5", "UTC-3:30") for an IANA timezone at a given moment.
 * Used for terminal clock display like "UTC+5 · Asia/Karachi".
 */
export function getUtcOffsetLabel(iana: IanaTimezone, at: Date = new Date()): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'shortOffset',
    })
    const parts = dtf.formatToParts(at)
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC'
    // Normalize "GMT+5" → "UTC+5"
    return offsetPart.replace(/^GMT/, 'UTC')
  } catch {
    return 'UTC'
  }
}
