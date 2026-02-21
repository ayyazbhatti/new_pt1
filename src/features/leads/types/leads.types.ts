// Lead
export type LeadStatus = 'open' | 'converted' | 'lost' | 'junk'
export type LeadPriority = 'low' | 'normal' | 'high' | 'vip'

export interface Lead {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  country: string
  city: string
  language: string
  timezone: string
  status: LeadStatus
  stageId: string
  ownerUserId: string
  teamId: string
  source: string
  campaign: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  tags: string[]
  priority: LeadPriority
  score: number
  lastContactAt: string | null
  nextFollowupAt: string | null
  createdAt: string
  updatedAt: string
}

// LeadStage
export interface LeadStageRules {
  requireEmail?: boolean
  requirePhone?: boolean
}

export interface LeadStage {
  id: string
  name: string
  order: number
  colorToken: string
  slaMinutes: number | null
  rules: LeadStageRules
}

// LeadActivity
export type LeadActivityType = 'call' | 'email' | 'note' | 'stage_change' | 'assign' | 'created'

export interface LeadActivity {
  id: string
  leadId: string
  type: LeadActivityType
  payload: Record<string, unknown>
  createdAt: string
  actorUserId: string
}

// LeadTask
export type LeadTaskType = 'call' | 'email' | 'whatsapp' | 'meeting' | 'doc'
export type LeadTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface LeadTask {
  id: string
  leadId: string
  type: LeadTaskType
  dueAt: string
  completedAt: string | null
  assignedToUserId: string
  priority: LeadPriority
  notes: string
  status: LeadTaskStatus
  createdAt: string
  updatedAt: string
}

// LeadMessage (communications)
export type LeadMessageType = 'email' | 'note'
export type LeadMessageStatus = 'queued' | 'sent' | 'failed'

export interface LeadMessage {
  id: string
  leadId: string
  type: LeadMessageType
  subject?: string
  body: string
  status: LeadMessageStatus
  providerMessageId?: string
  createdAt: string
  actorUserId: string
}

// EmailTemplate
export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  tags: string[]
  createdAt: string
}

// API payloads
export interface ListLeadsParams {
  status?: LeadStatus
  stageId?: string
  ownerUserId?: string
  source?: string
  country?: string
  scoreMin?: number
  scoreMax?: number
  dateFrom?: string
  dateTo?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface CreateLeadPayload {
  firstName: string
  lastName: string
  email: string
  phone?: string
  country?: string
  city?: string
  language?: string
  timezone?: string
  stageId: string
  ownerUserId?: string
  teamId?: string
  source?: string
  campaign?: string
  tags?: string[]
  priority?: LeadPriority
}

export interface UpdateLeadPayload extends Partial<CreateLeadPayload> {}

export interface CreateTaskPayload {
  leadId: string
  type: LeadTaskType
  dueAt: string
  assignedToUserId: string
  priority?: LeadPriority
  notes?: string
}

export interface LogCallPayload {
  leadId: string
  outcome: string
  durationMinutes?: number
  notes?: string
  nextFollowupAt?: string
}

export interface SendEmailPayload {
  leadId: string
  templateId?: string
  subject: string
  body: string
  to: string
  cc?: string
  bcc?: string
}

export type Role = 'admin' | 'manager' | 'agent'
