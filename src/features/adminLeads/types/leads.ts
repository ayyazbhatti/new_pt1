/** Lead status in the pipeline */
export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal_sent'
  | 'negotiation'
  | 'converted'
  | 'lost'

/** Lead source / channel */
export type LeadSource =
  | 'website'
  | 'landing_page'
  | 'demo_request'
  | 'chat'
  | 'google_ad'
  | 'meta_ad'
  | 'referral'
  | 'event'
  | 'other'

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal_sent: 'Proposal sent',
  negotiation: 'Negotiation',
  converted: 'Converted',
  lost: 'Lost',
}

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: 'Website',
  landing_page: 'Landing page',
  demo_request: 'Demo request',
  chat: 'Chat',
  google_ad: 'Google ad',
  meta_ad: 'Meta ad',
  referral: 'Referral',
  event: 'Event',
  other: 'Other',
}

export type ActivityType = 'note' | 'call' | 'email' | 'status_change'

export interface LeadActivity {
  id: string
  leadId: string
  type: ActivityType
  content: string
  createdAt: string
  createdBy: string
  meta?: Record<string, unknown>
}

export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  company?: string
  source: LeadSource
  campaign?: string
  status: LeadStatus
  ownerId?: string
  ownerName?: string
  score?: number
  createdAt: string
  updatedAt: string
  lastActivityAt?: string
  convertedUserId?: string
  convertedAt?: string
}

export interface CreateLeadPayload {
  name: string
  email: string
  phone?: string
  company?: string
  source: LeadSource
  campaign?: string
  status?: LeadStatus
  ownerId?: string
  score?: number
  notes?: string
}

export interface UpdateLeadPayload {
  name?: string
  email?: string
  phone?: string
  company?: string
  source?: LeadSource
  campaign?: string
  status?: LeadStatus
  ownerId?: string
  ownerName?: string
  score?: number
}
