/**
 * Map backend (snake_case) responses to frontend (camelCase) types.
 * Backend is core-api (Rust/Serde); frontend uses camelCase.
 */

import type { Lead, LeadStage, LeadActivity, LeadTask, LeadMessage, EmailTemplate } from '../types/leads.types'

function str(o: unknown): string {
  if (o == null) return ''
  return String(o)
}
function num(o: unknown): number {
  if (o == null) return 0
  const n = Number(o)
  return Number.isFinite(n) ? n : 0
}
function arr<T>(o: unknown, f: (x: unknown) => T): T[] {
  if (!Array.isArray(o)) return []
  return o.map(f)
}

export function mapLead(r: Record<string, unknown>): Lead {
  return {
    id: str(r.id),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    email: str(r.email ?? ''),
    phone: str(r.phone ?? ''),
    country: str(r.country ?? ''),
    city: str(r.city ?? ''),
    language: str(r.language ?? ''),
    timezone: str(r.timezone ?? ''),
    status: (str(r.status) || 'open') as Lead['status'],
    stageId: str(r.stage_id),
    ownerUserId: r.owner_user_id != null ? str(r.owner_user_id) : '',
    teamId: str(r.team_id),
    source: str(r.source ?? ''),
    campaign: str(r.campaign ?? ''),
    utmSource: r.utm_source != null ? str(r.utm_source) : undefined,
    utmMedium: r.utm_medium != null ? str(r.utm_medium) : undefined,
    utmCampaign: r.utm_campaign != null ? str(r.utm_campaign) : undefined,
    tags: arr(r.tags, String),
    priority: (str(r.priority) || 'normal') as Lead['priority'],
    score: num(r.score),
    lastContactAt: r.last_contact_at != null ? str(r.last_contact_at) : null,
    nextFollowupAt: r.next_followup_at != null ? str(r.next_followup_at) : null,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  }
}

export function mapStage(r: Record<string, unknown>): LeadStage {
  return {
    id: str(r.id),
    name: str(r.name),
    order: num(r.position ?? r.order),
    colorToken: str(r.color_token ?? r.colorToken ?? '#3b82f6'),
    slaMinutes: r.sla_minutes != null ? num(r.sla_minutes) : null,
    rules: {
      requireEmail: Boolean(r.require_email ?? r.requireEmail),
      requirePhone: Boolean(r.require_phone ?? r.requirePhone),
    },
  }
}

export function mapActivity(r: Record<string, unknown>): LeadActivity {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    type: (str(r.activity_type ?? r.type) || 'note') as LeadActivity['type'],
    payload: (typeof r.payload === 'object' && r.payload != null ? r.payload : {}) as Record<string, unknown>,
    createdAt: str(r.created_at),
    actorUserId: str(r.actor_user_id),
  }
}

export function mapTask(r: Record<string, unknown>): LeadTask {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    type: (str(r.task_type ?? r.type) || 'call') as LeadTask['type'],
    dueAt: str(r.due_at),
    completedAt: r.completed_at != null ? str(r.completed_at) : null,
    assignedToUserId: str(r.assigned_to_user_id),
    priority: (str(r.priority) || 'normal') as LeadTask['priority'],
    notes: str(r.notes ?? ''),
    status: (str(r.status) || 'pending') as LeadTask['status'],
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  }
}

export function mapMessage(r: Record<string, unknown>): LeadMessage {
  return {
    id: str(r.id),
    leadId: str(r.lead_id),
    type: (str(r.message_type ?? r.type) || 'email') as LeadMessage['type'],
    subject: r.subject != null ? str(r.subject) : undefined,
    body: str(r.body ?? ''),
    status: (str(r.status) || 'queued') as LeadMessage['status'],
    providerMessageId: r.provider_message_id != null ? str(r.provider_message_id) : undefined,
    createdAt: str(r.created_at),
    actorUserId: str(r.actor_user_id),
  }
}

export function mapTemplate(r: Record<string, unknown>): EmailTemplate {
  return {
    id: str(r.id),
    name: str(r.name),
    subject: str(r.subject),
    body: str(r.body),
    tags: arr(r.tags, String),
    createdAt: str(r.created_at),
  }
}

/** Build query string for listLeads (backend expects snake_case params). */
export function listLeadsQuery(params: {
  page?: number
  pageSize?: number
  status?: string
  stageId?: string
  ownerUserId?: string
  search?: string
  source?: string
  country?: string
  scoreMin?: number
  scoreMax?: number
}): string {
  const q = new URLSearchParams()
  if (params.page != null) q.set('page', String(params.page))
  if (params.pageSize != null) q.set('page_size', String(params.pageSize))
  if (params.status != null) q.set('status', params.status)
  if (params.stageId != null) q.set('stage_id', params.stageId)
  if (params.ownerUserId != null) q.set('owner_user_id', params.ownerUserId)
  if (params.search != null) q.set('search', params.search)
  if (params.source != null) q.set('source', params.source)
  if (params.country != null) q.set('country', params.country)
  if (params.scoreMin != null) q.set('score_min', String(params.scoreMin))
  if (params.scoreMax != null) q.set('score_max', String(params.scoreMax))
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Convert create lead payload to backend snake_case body. */
export function createLeadBody(payload: {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  country?: string
  city?: string
  language?: string
  timezone?: string
  stageId: string
  ownerUserId?: string
  source?: string
  campaign?: string
  tags?: string[]
  priority?: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: payload.firstName,
    last_name: payload.lastName,
    stage_id: payload.stageId,
  }
  if (payload.email !== undefined) body.email = payload.email
  if (payload.phone !== undefined) body.phone = payload.phone
  if (payload.country !== undefined) body.country = payload.country
  if (payload.city !== undefined) body.city = payload.city
  if (payload.language !== undefined) body.language = payload.language
  if (payload.timezone !== undefined) body.timezone = payload.timezone
  if (payload.ownerUserId !== undefined) body.owner_user_id = payload.ownerUserId
  if (payload.source !== undefined) body.source = payload.source
  if (payload.campaign !== undefined) body.campaign = payload.campaign
  if (payload.tags !== undefined) body.tags = payload.tags
  if (payload.priority !== undefined) body.priority = payload.priority
  return body
}
