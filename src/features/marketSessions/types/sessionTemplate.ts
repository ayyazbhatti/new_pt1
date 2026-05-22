export type SessionDefaultMarket = 'crypto' | 'forex' | 'commodities' | 'indices' | 'stocks'

export interface SessionTemplateWindow {
  id?: string
  dayOfWeek: number
  openTime: string
  closeTime: string
}

export interface SessionTemplate {
  id: string
  name: string
  timezone: string
  description?: string | null
  is24_7: boolean
  isDefaultForMarket?: string | null
  windows: SessionTemplateWindow[]
  createdAt: string
  updatedAt: string
  updatedBy?: string | null
}

export interface CreateSessionTemplatePayload {
  name: string
  timezone: string
  description?: string | null
  is24_7: boolean
  isDefaultForMarket?: string | null
  windows: Omit<SessionTemplateWindow, 'id'>[]
}

export type UpdateSessionTemplatePayload = CreateSessionTemplatePayload

export type MarketHolidayType = 'closed' | 'half_day'

export interface MarketHoliday {
  id: string
  templateId: string
  /** `YYYY-MM-DD` */
  holidayDate: string
  name: string
  type: MarketHolidayType
  /** `HH:MM` or `HH:MM:SS` when type is `half_day` */
  halfDayCloseTime?: string | null
  notes?: string | null
  createdAt: string
}

export interface UpsertMarketHolidayPayload {
  holidayDate: string
  name: string
  type: MarketHolidayType
  halfDayCloseTime?: string | null
  notes?: string | null
}
