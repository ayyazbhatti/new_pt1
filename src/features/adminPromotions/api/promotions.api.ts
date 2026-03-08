import { http } from '@/shared/api/http'
import type { PromotionSlide, CreateSlidePayload, UpdateSlidePayload, ReorderPayload, TogglePayload } from '../types/promotions'

function toSlide(obj: Record<string, unknown>): PromotionSlide {
  return {
    id: String(obj.id ?? ''),
    sortOrder: Number(obj.sort_order ?? 0),
    imageUrl: String(obj.image_url ?? ''),
    title: String(obj.title ?? ''),
    subtitle: obj.subtitle != null ? String(obj.subtitle) : null,
    linkUrl: obj.link_url != null ? String(obj.link_url) : null,
    linkLabel: obj.link_label != null ? String(obj.link_label) : null,
    isActive: obj.is_active as boolean | undefined,
    createdAt: obj.created_at as string | undefined,
    updatedAt: obj.updated_at as string | undefined,
  }
}

export async function listPromotionSlides(): Promise<PromotionSlide[]> {
  const response = await http<unknown>(`/api/admin/promotions/slides`, { method: 'GET' })
  const arr = Array.isArray(response) ? response : []
  return arr.map((item: Record<string, unknown>) => toSlide(item))
}

export async function createPromotionSlide(payload: CreateSlidePayload): Promise<PromotionSlide> {
  const response = await http<Record<string, unknown>>(`/api/admin/promotions/slides`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return toSlide(response)
}

export async function updatePromotionSlide(id: string, payload: UpdateSlidePayload): Promise<PromotionSlide> {
  const response = await http<Record<string, unknown>>(`/api/admin/promotions/slides/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return toSlide(response)
}

export async function deletePromotionSlide(id: string): Promise<void> {
  await http(`/api/admin/promotions/slides/${id}`, { method: 'DELETE' })
}

export async function reorderPromotionSlides(payload: ReorderPayload): Promise<void> {
  await http(`/api/admin/promotions/slides/reorder`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function togglePromotionSlide(id: string, payload: TogglePayload): Promise<PromotionSlide> {
  const response = await http<Record<string, unknown>>(`/api/admin/promotions/slides/${id}/toggle`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return toSlide(response)
}
