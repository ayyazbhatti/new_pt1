import { http } from '@/shared/api/http'
import type { Tag } from '../types/tag'

/** Backend response shape (snake_case) */
export interface TagDto {
  id: string
  name: string
  slug: string
  color: string
  description: string | null
  created_at: string
  updated_at: string
  user_count: number
  manager_count: number
  created_by_user_id?: string | null
  created_by_email?: string | null
}

function fromDto(d: TagDto): Tag {
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    color: d.color,
    description: d.description ?? undefined,
    userCount: d.user_count,
    managerCount: d.manager_count,
    createdAt: d.created_at,
    createdByUserId: d.created_by_user_id ?? undefined,
    createdByEmail: d.created_by_email ?? undefined,
  }
}

export interface ListTagsParams {
  search?: string
}

export async function listTags(params?: ListTagsParams): Promise<Tag[]> {
  const searchParams = new URLSearchParams()
  if (params?.search?.trim()) searchParams.set('search', params.search.trim())
  const query = searchParams.toString()
  const list = await http<TagDto[]>(
    `/api/admin/tags${query ? `?${query}` : ''}`,
    { method: 'GET' }
  )
  return list.map(fromDto)
}

export interface CreateTagPayload {
  name: string
  slug: string
  color?: string
  description?: string | null
}

export async function createTag(payload: CreateTagPayload): Promise<Tag> {
  const body = {
    name: payload.name.trim(),
    slug: payload.slug.trim().toLowerCase(),
    color: payload.color?.trim() || undefined,
    description: payload.description?.trim() || null,
  }
  const d = await http<TagDto>('/api/admin/tags', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return fromDto(d)
}

export interface UpdateTagPayload {
  name?: string
  slug?: string
  color?: string
  description?: string | null
}

export async function updateTag(id: string, payload: UpdateTagPayload): Promise<Tag> {
  const body: Record<string, unknown> = {}
  if (payload.name !== undefined) body.name = payload.name.trim()
  if (payload.slug !== undefined) body.slug = payload.slug.trim().toLowerCase()
  if (payload.color !== undefined) body.color = payload.color.trim()
  if (payload.description !== undefined) body.description = payload.description?.trim() ?? null
  const d = await http<TagDto>(`/api/admin/tags/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return fromDto(d)
}

export async function deleteTag(id: string): Promise<void> {
  await http<{ success: boolean }>(`/api/admin/tags/${id}`, { method: 'DELETE' })
}
