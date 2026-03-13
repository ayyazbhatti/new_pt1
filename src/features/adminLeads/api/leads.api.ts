import { http } from '@/shared/api/http'
import type {
  Lead,
  LeadActivity,
  LeadSource,
  CreateLeadPayload,
  UpdateLeadPayload,
} from '../types/leads'

/** Leads always use the backend API. Exported for pages that show API vs store stats. */
export const LEADS_USE_API = true

// ---------------------------------------------------------------------------
// API response types (snake_case from backend)
// ---------------------------------------------------------------------------

interface LeadApiResponse {
  id: string
  name: string
  email: string
  phone?: string | null
  company?: string | null
  source: string
  campaign?: string | null
  status: string
  owner_id?: string | null
  owner_name?: string | null
  created_by_id?: string | null
  created_by_email?: string | null
  score?: number | null
  created_at: string
  updated_at: string
  last_activity_at?: string | null
  converted_user_id?: string | null
  converted_at?: string | null
}

interface LeadActivityApiResponse {
  id: string
  lead_id: string
  type: string
  content: string
  created_at: string
  created_by: string
  meta?: Record<string, unknown>
}

function mapLeadFromApi(r: LeadApiResponse): Lead {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone ?? undefined,
    company: r.company ?? undefined,
    source: r.source as Lead['source'],
    campaign: r.campaign ?? undefined,
    status: r.status as Lead['status'],
    ownerId: r.owner_id ?? undefined,
    ownerName: r.owner_name ?? undefined,
    createdByUserId: r.created_by_id ?? undefined,
    createdByEmail: r.created_by_email ?? undefined,
    score: r.score ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at ?? undefined,
    convertedUserId: r.converted_user_id ?? undefined,
    convertedAt: r.converted_at ?? undefined,
  }
}

function mapActivityFromApi(r: LeadActivityApiResponse): LeadActivity {
  return {
    id: r.id,
    leadId: r.lead_id,
    type: r.type as LeadActivity['type'],
    content: r.content,
    createdAt: r.created_at,
    createdBy: r.created_by,
    meta: r.meta,
  }
}

// ---------------------------------------------------------------------------
// List params and response
// ---------------------------------------------------------------------------

export interface ListLeadsParams {
  page?: number
  page_size?: number
  search?: string
  status?: string
  source?: string
  owner_id?: string
  sort?: string
  order?: 'asc' | 'desc'
}

export interface ListLeadsResponse {
  items: Lead[]
  total: number
}

export interface LeadOwner {
  id: string
  name: string
  email: string
}

// ---------------------------------------------------------------------------
// List lead owners (for assign-owner dropdown)
// ---------------------------------------------------------------------------

export async function listLeadOwners(): Promise<LeadOwner[]> {
  const res = await http<LeadOwner[]>(`/api/leads/owners`)
  return Array.isArray(res) ? res : []
}

// ---------------------------------------------------------------------------
// List leads
// ---------------------------------------------------------------------------

export async function listLeads(params?: ListLeadsParams): Promise<ListLeadsResponse> {
  const query = new URLSearchParams()
  const page = params?.page ?? 1
  const pageSize = params?.page_size ?? 20
  query.set('page', String(page))
  query.set('page_size', String(pageSize))
  if (params?.search?.trim()) query.set('search', params.search.trim())
  if (params?.status && params.status !== 'all') query.set('status', params.status)
  if (params?.source && params.source !== 'all') query.set('source', params.source)
  if (params?.owner_id) query.set('owner_id', params.owner_id)
  if (params?.sort) query.set('sort', params.sort)
  if (params?.order) query.set('order', params.order)

  const res = await http<{ items: LeadApiResponse[]; total: number }>(
    `/api/leads?${query.toString()}`
  )
  return {
    items: (res.items ?? []).map(mapLeadFromApi),
    total: res.total ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Get single lead
// ---------------------------------------------------------------------------

export async function getLeadById(id: string): Promise<Lead | null> {
  try {
    const res = await http<LeadApiResponse>(`/api/leads/${id}`)
    return mapLeadFromApi(res)
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return null
    throw err
  }
}

// ---------------------------------------------------------------------------
// Get lead activities
// ---------------------------------------------------------------------------

export async function getLeadActivities(leadId: string): Promise<LeadActivity[]> {
  const res = await http<
    { items: LeadActivityApiResponse[] } | LeadActivityApiResponse[]
  >(`/api/leads/${leadId}/activities`)
  const raw = Array.isArray(res) ? res : (res as { items: LeadActivityApiResponse[] }).items ?? []
  return (raw as LeadActivityApiResponse[]).map(mapActivityFromApi)
}

// ---------------------------------------------------------------------------
// Create lead
// ---------------------------------------------------------------------------

export async function createLead(payload: CreateLeadPayload): Promise<Lead> {
  const body = {
    name: payload.name,
    email: payload.email,
    phone: payload.phone ?? null,
    company: payload.company ?? null,
    source: payload.source,
    campaign: payload.campaign ?? null,
    status: payload.status ?? null,
    owner_id: payload.ownerId ?? null,
    score: payload.score ?? null,
    notes: payload.notes ?? null,
  }
  const res = await http<LeadApiResponse>('/api/leads', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return mapLeadFromApi(res)
}

// ---------------------------------------------------------------------------
// Update lead
// ---------------------------------------------------------------------------

export async function updateLead(id: string, payload: UpdateLeadPayload): Promise<Lead> {
  const body: Record<string, unknown> = {}
  if (payload.name !== undefined) body.name = payload.name
  if (payload.email !== undefined) body.email = payload.email
  if (payload.phone !== undefined) body.phone = payload.phone
  if (payload.company !== undefined) body.company = payload.company
  if (payload.source !== undefined) body.source = payload.source
  if (payload.campaign !== undefined) body.campaign = payload.campaign
  if (payload.status !== undefined) body.status = payload.status
  if (payload.ownerId !== undefined) body.owner_id = payload.ownerId
  if (payload.ownerName !== undefined) body.owner_name = payload.ownerName
  if (payload.score !== undefined) body.score = payload.score

  const res = await http<LeadApiResponse>(`/api/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return mapLeadFromApi(res)
}

// ---------------------------------------------------------------------------
// Delete lead
// ---------------------------------------------------------------------------

export async function deleteLead(id: string): Promise<void> {
  await http(`/api/leads/${id}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Add activity
// ---------------------------------------------------------------------------

export async function addLeadActivity(
  leadId: string,
  type: LeadActivity['type'],
  content: string,
  _createdBy: string
): Promise<LeadActivity> {
  const res = await http<LeadActivityApiResponse>(`/api/leads/${leadId}/activities`, {
    method: 'POST',
    body: JSON.stringify({ type, content, meta: {} }),
  })
  return mapActivityFromApi(res)
}

// ---------------------------------------------------------------------------
// Convert lead
// ---------------------------------------------------------------------------

export async function convertLead(id: string, convertedUserId?: string): Promise<Lead> {
  const res = await http<LeadApiResponse>(`/api/leads/${id}/convert`, {
    method: 'POST',
    body: JSON.stringify({ user_id: convertedUserId ?? null }),
  })
  return mapLeadFromApi(res)
}
