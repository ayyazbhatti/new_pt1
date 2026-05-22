import { http } from '@/shared/api/http'
import type { MarketHoliday, UpsertMarketHolidayPayload } from '../types/sessionTemplate'

function mapHoliday(row: Record<string, unknown>): MarketHoliday {
  return {
    id: String(row.id ?? ''),
    templateId: String(row.templateId ?? row.template_id ?? ''),
    holidayDate: String(row.holidayDate ?? row.holiday_date ?? ''),
    name: String(row.name ?? ''),
    type: (row.type === 'half_day' || row.type === 'closed' ? row.type : 'closed') as MarketHoliday['type'],
    halfDayCloseTime:
      row.halfDayCloseTime != null
        ? String(row.halfDayCloseTime)
        : row.half_day_close_time != null
          ? String(row.half_day_close_time)
          : null,
    notes: (row.notes as string | null | undefined) ?? null,
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
  }
}

export async function listTemplateHolidays(templateId: string, year?: number): Promise<MarketHoliday[]> {
  const q = year != null ? `?year=${encodeURIComponent(String(year))}` : ''
  const res = await http<Record<string, unknown>[]>(
    `/api/admin/sessions/templates/${encodeURIComponent(templateId)}/holidays${q}`,
    { method: 'GET' }
  )
  return (res ?? []).map(mapHoliday)
}

export async function createTemplateHoliday(
  templateId: string,
  payload: UpsertMarketHolidayPayload
): Promise<MarketHoliday> {
  const res = await http<Record<string, unknown>>(
    `/api/admin/sessions/templates/${encodeURIComponent(templateId)}/holidays`,
    {
      method: 'POST',
      body: JSON.stringify({
        holidayDate: payload.holidayDate,
        name: payload.name.trim(),
        type: payload.type,
        halfDayCloseTime: payload.halfDayCloseTime?.trim() || null,
        notes: payload.notes?.trim() || null,
      }),
    }
  )
  return mapHoliday(res)
}

export async function updateTemplateHoliday(
  holidayId: string,
  payload: UpsertMarketHolidayPayload
): Promise<MarketHoliday> {
  const res = await http<Record<string, unknown>>(`/api/admin/sessions/holidays/${encodeURIComponent(holidayId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      holidayDate: payload.holidayDate,
      name: payload.name.trim(),
      type: payload.type,
      halfDayCloseTime: payload.halfDayCloseTime?.trim() || null,
      notes: payload.notes?.trim() || null,
    }),
  })
  return mapHoliday(res)
}

export async function deleteTemplateHoliday(holidayId: string): Promise<void> {
  await http(`/api/admin/sessions/holidays/${encodeURIComponent(holidayId)}`, { method: 'DELETE' })
}
