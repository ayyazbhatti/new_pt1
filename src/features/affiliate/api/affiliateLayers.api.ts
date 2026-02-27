import { http } from '@/shared/api/http'

/** Backend response shape (snake_case) */
export interface AffiliateLayerDto {
  id: string
  level: number
  name: string
  commission_percent: number
  created_at: string
  updated_at: string
}

export interface AffiliateLayer {
  id: string
  level: number
  name: string
  commissionPercent: number
  createdAt: string
  updatedAt: string
}

function fromDto(d: AffiliateLayerDto): AffiliateLayer {
  return {
    id: d.id,
    level: d.level,
    name: d.name,
    commissionPercent: d.commission_percent,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

export async function listAffiliateLayers(): Promise<AffiliateLayer[]> {
  const list = await http<AffiliateLayerDto[]>('/api/admin/affiliate/layers', {
    method: 'GET',
  })
  return list.map(fromDto)
}

export interface CreateAffiliateLayerPayload {
  level?: number
  name: string
  commission_percent?: number
}

export async function createAffiliateLayer(
  payload: CreateAffiliateLayerPayload
): Promise<AffiliateLayer> {
  const body = {
    name: payload.name.trim(),
    level: payload.level,
    commission_percent: payload.commission_percent,
  }
  const d = await http<AffiliateLayerDto>('/api/admin/affiliate/layers', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return fromDto(d)
}

export interface UpdateAffiliateLayerPayload {
  name?: string
  commission_percent?: number
}

export async function updateAffiliateLayer(
  id: string,
  payload: UpdateAffiliateLayerPayload
): Promise<AffiliateLayer> {
  const body: Record<string, unknown> = {}
  if (payload.name !== undefined) body.name = payload.name.trim()
  if (payload.commission_percent !== undefined)
    body.commission_percent = payload.commission_percent
  const d = await http<AffiliateLayerDto>(`/api/admin/affiliate/layers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return fromDto(d)
}

export async function deleteAffiliateLayer(id: string): Promise<void> {
  await http(`/api/admin/affiliate/layers/${id}`, { method: 'DELETE' })
}
