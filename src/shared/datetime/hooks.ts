import { useContext, useCallback } from 'react'
import { TimezoneContext } from './context'
import * as fmt from './format'
import { getUtcOffsetLabel } from './resolve'
import type { DateInput } from './format'
import type { ResolvedTimezone } from './types'

export function useEffectiveTimezone(): ResolvedTimezone {
  return useContext(TimezoneContext)
}

export function useFormatDateTime() {
  const tz = useEffectiveTimezone().iana
  return useCallback((input: DateInput) => fmt.formatDateTime(input, tz), [tz])
}

export function useFormatDate() {
  const tz = useEffectiveTimezone().iana
  return useCallback((input: DateInput) => fmt.formatDate(input, tz), [tz])
}

export function useFormatTime() {
  const tz = useEffectiveTimezone().iana
  return useCallback((input: DateInput) => fmt.formatTime(input, tz), [tz])
}

export function useFormatDateTimeSeconds() {
  const tz = useEffectiveTimezone().iana
  return useCallback((input: DateInput) => fmt.formatDateTimeSeconds(input, tz), [tz])
}

export function useFormatRelative() {
  const tz = useEffectiveTimezone().iana
  return useCallback((input: DateInput, now?: Date) => fmt.formatRelative(input, tz, now), [tz])
}

/** Returns the offset label like "UTC+5" for the current effective timezone */
export function useTimezoneOffsetLabel(): string {
  const tz = useEffectiveTimezone().iana
  return getUtcOffsetLabel(tz)
}
