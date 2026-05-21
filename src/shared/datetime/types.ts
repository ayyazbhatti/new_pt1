/** IANA timezone string, e.g. 'Europe/London', 'Asia/Karachi', 'UTC' */
export type IanaTimezone = string

export interface TimezoneSource {
  /** Per-user override, highest priority */
  userTimezone?: IanaTimezone | null
  /** Group-level default */
  groupTimezone?: IanaTimezone | null
  /** Platform-wide default set by admin */
  platformTimezone?: IanaTimezone | null
}

/** Where the resolved timezone came from — useful for UI labels and debugging */
export type TimezoneOrigin = 'user' | 'group' | 'platform' | 'fallback'

export interface ResolvedTimezone {
  /** Final IANA string used for formatting */
  iana: IanaTimezone
  /** Where it came from */
  origin: TimezoneOrigin
}
