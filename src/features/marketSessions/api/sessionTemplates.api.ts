import { http } from '@/shared/api/http'
import type {
  CreateSessionTemplatePayload,
  SessionTemplate,
  SessionTemplateWindow,
  UpdateSessionTemplatePayload,
} from '../types/sessionTemplate'

function mapWindow(w: Record<string, unknown>): SessionTemplateWindow {
  return {
    id: w.id != null ? String(w.id) : undefined,
    dayOfWeek: Number(w.dayOfWeek ?? w.day_of_week ?? 0),
    openTime: String(w.openTime ?? w.open_time ?? ''),
    closeTime: String(w.closeTime ?? w.close_time ?? ''),
  }
}

function mapTemplate(obj: Record<string, unknown>): SessionTemplate {
  const rawWindows = (obj.windows as Record<string, unknown>[] | undefined) ?? []
  return {
    id: String(obj.id ?? ''),
    name: String(obj.name ?? ''),
    timezone: String(obj.timezone ?? 'UTC'),
    description: (obj.description as string | null | undefined) ?? null,
    // `is247` was serde camelCase for `is_24_7` before explicit `is24_7` rename on the API.
    is24_7: Boolean(obj.is24_7 ?? obj['is247'] ?? obj.is_24_7),
    isDefaultForMarket: (obj.isDefaultForMarket as string | null | undefined) ?? null,
    windows: rawWindows.map(mapWindow),
    createdAt: String(obj.createdAt ?? obj.created_at ?? ''),
    updatedAt: String(obj.updatedAt ?? obj.updated_at ?? ''),
    updatedBy: (obj.updatedBy as string | null | undefined) ?? (obj.updated_by as string | null | undefined) ?? null,
  }
}

function windowsToBody(windows: Omit<SessionTemplateWindow, 'id'>[]) {
  return windows.map((w) => ({
    dayOfWeek: w.dayOfWeek,
    openTime: normalizeTimeForApi(w.openTime),
    closeTime: normalizeTimeForApi(w.closeTime),
  }))
}

function normalizeTimeForApi(s: string): string {
  const t = s.trim()
  if (!t) return '00:00:00'
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`
  return t
}

export function normalizeTimeForInput(s: string): string {
  const t = (s ?? '').trim()
  if (!t) return '09:00'
  if (t.length >= 5 && /^\d{2}:\d{2}/.test(t)) return t.slice(0, 5)
  return t
}

export async function listSessionTemplates(): Promise<SessionTemplate[]> {
  const res = await http<Record<string, unknown>[]>(`/api/admin/sessions/templates`, { method: 'GET' })
  return (res ?? []).map((row) => mapTemplate(row))
}

export async function getSessionTemplate(id: string): Promise<SessionTemplate> {
  const res = await http<Record<string, unknown>>(`/api/admin/sessions/templates/${id}`, { method: 'GET' })
  return mapTemplate(res)
}

export async function createSessionTemplate(payload: CreateSessionTemplatePayload): Promise<SessionTemplate> {
  const res = await http<Record<string, unknown>>('/api/admin/sessions/templates', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name.trim(),
      timezone: payload.timezone.trim(),
      description: payload.description?.trim() ? payload.description.trim() : null,
      is24_7: payload.is24_7,
      isDefaultForMarket: payload.isDefaultForMarket ?? null,
      windows: windowsToBody(payload.windows),
    }),
  })
  return mapTemplate(res)
}

export async function updateSessionTemplate(
  id: string,
  payload: UpdateSessionTemplatePayload
): Promise<SessionTemplate> {
  const res = await http<Record<string, unknown>>(`/api/admin/sessions/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: payload.name.trim(),
      timezone: payload.timezone.trim(),
      description: payload.description?.trim() ? payload.description.trim() : null,
      is24_7: payload.is24_7,
      isDefaultForMarket: payload.isDefaultForMarket ?? null,
      windows: windowsToBody(payload.windows),
    }),
  })
  return mapTemplate(res)
}

export async function deleteSessionTemplate(id: string): Promise<void> {
  await http(`/api/admin/sessions/templates/${id}`, { method: 'DELETE' })
}
