import type {
  Lead,
  LeadStage,
  LeadActivity,
  LeadTask,
  LeadMessage,
  EmailTemplate,
  ListLeadsParams,
  CreateLeadPayload,
  UpdateLeadPayload,
  CreateTaskPayload,
  LogCallPayload,
  SendEmailPayload,
} from '../types/leads.types'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Mock stages
export const mockStages: LeadStage[] = [
  { id: 's1', name: 'New', order: 1, colorToken: '#3b82f6', slaMinutes: 60, rules: {} },
  { id: 's2', name: 'Contacted', order: 2, colorToken: '#8b5cf6', slaMinutes: 1440, rules: { requirePhone: true } },
  { id: 's3', name: 'Qualified', order: 3, colorToken: '#22c55e', slaMinutes: null, rules: { requireEmail: true, requirePhone: true } },
  { id: 's4', name: 'Proposal', order: 4, colorToken: '#f59e0b', slaMinutes: 4320, rules: {} },
  { id: 's5', name: 'Won', order: 5, colorToken: '#10b981', slaMinutes: null, rules: {} },
  { id: 's6', name: 'Lost', order: 6, colorToken: '#ef4444', slaMinutes: null, rules: {} },
]

// Mock users (agents)
export const mockUsers = [
  { id: 'u1', name: 'Alice Agent', email: 'alice@example.com' },
  { id: 'u2', name: 'Bob Agent', email: 'bob@example.com' },
  { id: 'u3', name: 'Carol Agent', email: 'carol@example.com' },
]

// In-memory stores (simulate DB)
let mockLeads: Lead[] = [
  {
    id: 'l1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    country: 'US',
    city: 'New York',
    language: 'en',
    timezone: 'America/New_York',
    status: 'open',
    stageId: 's2',
    ownerUserId: 'u1',
    teamId: 't1',
    source: 'Website',
    campaign: 'Homepage',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'brand',
    tags: ['vip'],
    priority: 'high',
    score: 75,
    lastContactAt: '2024-02-18T10:00:00Z',
    nextFollowupAt: '2024-02-20T14:00:00Z',
    createdAt: '2024-02-01T09:00:00Z',
    updatedAt: '2024-02-18T10:00:00Z',
  },
  {
    id: 'l2',
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@example.com',
    phone: '+1987654321',
    country: 'UK',
    city: 'London',
    language: 'en',
    timezone: 'Europe/London',
    status: 'open',
    stageId: 's1',
    ownerUserId: 'u2',
    teamId: 't1',
    source: 'Referral',
    campaign: '',
    utmSource: undefined,
    utmMedium: undefined,
    utmCampaign: undefined,
    tags: [],
    priority: 'normal',
    score: 45,
    lastContactAt: null,
    nextFollowupAt: null,
    createdAt: '2024-02-15T11:00:00Z',
    updatedAt: '2024-02-15T11:00:00Z',
  },
]

let mockActivities: LeadActivity[] = [
  { id: 'a1', leadId: 'l1', type: 'call', payload: { outcome: 'Interested', durationMinutes: 5 }, createdAt: '2024-02-18T10:00:00Z', actorUserId: 'u1' },
  { id: 'a2', leadId: 'l1', type: 'stage_change', payload: { from: 's1', to: 's2' }, createdAt: '2024-02-18T09:55:00Z', actorUserId: 'u1' },
]

let mockTasks: LeadTask[] = [
  { id: 't1', leadId: 'l1', type: 'call', dueAt: '2024-02-20T14:00:00Z', completedAt: null, assignedToUserId: 'u1', priority: 'high', notes: 'Follow up', status: 'pending', createdAt: '2024-02-18T10:00:00Z', updatedAt: '2024-02-18T10:00:00Z' },
]

let mockMessages: LeadMessage[] = [
  { id: 'm1', leadId: 'l1', type: 'email', subject: 'Welcome', body: 'Hi John...', status: 'sent', createdAt: '2024-02-17T12:00:00Z', actorUserId: 'u1' },
]

let mockTemplates: EmailTemplate[] = [
  { id: 'tmpl1', name: 'Welcome', subject: 'Welcome {{firstName}}', body: 'Hi {{firstName}} {{lastName}},\n\nThank you for your interest.', tags: ['onboarding'], createdAt: '2024-01-01T00:00:00Z' },
  { id: 'tmpl2', name: 'Follow-up', subject: 'Quick follow-up', body: 'Hi {{firstName}},\n\nJust checking in.', tags: [], createdAt: '2024-01-01T00:00:00Z' },
]

// Event emitter for mock WS (call from api to simulate server push)
type LeadWsHandler = (event: string, payload: unknown) => void
let wsHandlers: LeadWsHandler[] = []
export function subscribeLeadWs(handler: LeadWsHandler) {
  wsHandlers.push(handler)
  return () => {
    wsHandlers = wsHandlers.filter((h) => h !== handler)
  }
}
function emitLeadWs(event: string, payload: unknown) {
  wsHandlers.forEach((h) => {
    try {
      h(event, payload)
    } catch (_) {}
  })
}

export async function listLeadsMock(params: ListLeadsParams): Promise<{ items: Lead[]; total: number }> {
  await delay(300)
  let list = [...mockLeads]
  if (params.status) list = list.filter((l) => l.status === params.status)
  if (params.stageId) list = list.filter((l) => l.stageId === params.stageId)
  if (params.ownerUserId) list = list.filter((l) => l.ownerUserId === params.ownerUserId)
  if (params.source) list = list.filter((l) => l.source === params.source)
  if (params.country) list = list.filter((l) => l.country === params.country)
  if (params.scoreMin != null) list = list.filter((l) => l.score >= params.scoreMin!)
  if (params.scoreMax != null) list = list.filter((l) => l.score <= params.scoreMax!)
  if (params.search) {
    const q = params.search.toLowerCase()
    list = list.filter(
      (l) =>
        l.firstName.toLowerCase().includes(q) ||
        l.lastName.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.phone.includes(q)
    )
  }
  const total = list.length
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const start = (page - 1) * pageSize
  list = list.slice(start, start + pageSize)
  return { items: list, total }
}

export async function getLeadMock(id: string): Promise<Lead | null> {
  await delay(150)
  return mockLeads.find((l) => l.id === id) ?? null
}

export async function createLeadMock(payload: CreateLeadPayload): Promise<Lead> {
  await delay(200)
  const id = 'l' + Date.now()
  const now = new Date().toISOString()
  const lead: Lead = {
    id,
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    phone: payload.phone ?? '',
    country: payload.country ?? '',
    city: payload.city ?? '',
    language: payload.language ?? 'en',
    timezone: payload.timezone ?? 'UTC',
    status: 'open',
    stageId: payload.stageId,
    ownerUserId: payload.ownerUserId ?? 'u1',
    teamId: payload.teamId ?? 't1',
    source: payload.source ?? '',
    campaign: payload.campaign ?? '',
    utmSource: undefined,
    utmMedium: undefined,
    utmCampaign: undefined,
    tags: payload.tags ?? [],
    priority: payload.priority ?? 'normal',
    score: 0,
    lastContactAt: null,
    nextFollowupAt: null,
    createdAt: now,
    updatedAt: now,
  }
  mockLeads.push(lead)
  emitLeadWs('lead.created', lead)
  return lead
}

export async function updateLeadMock(id: string, payload: UpdateLeadPayload): Promise<Lead | null> {
  await delay(200)
  const idx = mockLeads.findIndex((l) => l.id === id)
  if (idx === -1) return null
  mockLeads[idx] = { ...mockLeads[idx], ...payload, updatedAt: new Date().toISOString() }
  emitLeadWs('lead.updated', mockLeads[idx])
  return mockLeads[idx]
}

export async function assignLeadMock(id: string, ownerUserId: string): Promise<Lead | null> {
  await delay(200)
  const idx = mockLeads.findIndex((l) => l.id === id)
  if (idx === -1) return null
  mockLeads[idx] = { ...mockLeads[idx], ownerUserId, updatedAt: new Date().toISOString() }
  emitLeadWs('lead.assigned', { leadId: id, ownerUserId, lead: mockLeads[idx] })
  return mockLeads[idx]
}

export async function changeStageMock(id: string, stageId: string): Promise<Lead | null> {
  await delay(200)
  const idx = mockLeads.findIndex((l) => l.id === id)
  if (idx === -1) return null
  const prev = mockLeads[idx].stageId
  mockLeads[idx] = { ...mockLeads[idx], stageId, updatedAt: new Date().toISOString() }
  emitLeadWs('lead.stage_changed', { leadId: id, stageId, previousStageId: prev, lead: mockLeads[idx] })
  return mockLeads[idx]
}

export async function deleteLeadMock(id: string): Promise<boolean> {
  await delay(200)
  const before = mockLeads.length
  mockLeads = mockLeads.filter((l) => l.id !== id)
  if (mockLeads.length < before) {
    emitLeadWs('lead.deleted', { leadId: id })
    return true
  }
  return false
}

export async function listStagesMock(): Promise<LeadStage[]> {
  await delay(100)
  return [...mockStages]
}

export async function getLeadActivitiesMock(leadId: string): Promise<LeadActivity[]> {
  await delay(150)
  return mockActivities.filter((a) => a.leadId === leadId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function getLeadTasksMock(leadId: string): Promise<LeadTask[]> {
  await delay(150)
  return mockTasks.filter((t) => t.leadId === leadId).sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}

export async function getLeadMessagesMock(leadId: string): Promise<LeadMessage[]> {
  await delay(150)
  return mockMessages.filter((m) => m.leadId === leadId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export interface TaskWithLead {
  task: LeadTask
  lead: Lead
}

export async function listTasksMock(assignedToUserId?: string): Promise<TaskWithLead[]> {
  await delay(200)
  let list = mockTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  if (assignedToUserId) {
    list = list.filter((t) => t.assignedToUserId === assignedToUserId)
  }
  list = list.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  return list.map((task) => {
    const lead = mockLeads.find((l) => l.id === task.leadId)
    return { task, lead: lead! }
  }).filter((x) => x.lead)
}

export async function createTaskMock(payload: CreateTaskPayload): Promise<LeadTask> {
  await delay(200)
  const id = 'task' + Date.now()
  const now = new Date().toISOString()
  const task: LeadTask = {
    id,
    leadId: payload.leadId,
    type: payload.type,
    dueAt: payload.dueAt,
    completedAt: null,
    assignedToUserId: payload.assignedToUserId,
    priority: payload.priority ?? 'normal',
    notes: payload.notes ?? '',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  mockTasks.push(task)
  emitLeadWs('lead.task.created', task)
  return task
}

export async function completeTaskMock(taskId: string, notes?: string): Promise<LeadTask | null> {
  await delay(200)
  const idx = mockTasks.findIndex((t) => t.id === taskId)
  if (idx === -1) return null
  const now = new Date().toISOString()
  mockTasks[idx] = { ...mockTasks[idx], status: 'completed', completedAt: now, updatedAt: now, notes: notes ?? mockTasks[idx].notes }
  emitLeadWs('lead.task.completed', mockTasks[idx])
  return mockTasks[idx]
}

export async function logCallMock(payload: LogCallPayload): Promise<LeadActivity> {
  await delay(200)
  const id = 'act' + Date.now()
  const activity: LeadActivity = {
    id,
    leadId: payload.leadId,
    type: 'call',
    payload: { outcome: payload.outcome, durationMinutes: payload.durationMinutes, notes: payload.notes },
    createdAt: new Date().toISOString(),
    actorUserId: 'u1',
  }
  mockActivities.push(activity)
  const leadIdx = mockLeads.findIndex((l) => l.id === payload.leadId)
  if (leadIdx !== -1) {
    mockLeads[leadIdx] = {
      ...mockLeads[leadIdx],
      lastContactAt: activity.createdAt,
      nextFollowupAt: payload.nextFollowupAt ?? mockLeads[leadIdx].nextFollowupAt,
      updatedAt: activity.createdAt,
    }
  }
  emitLeadWs('lead.activity.added', activity)
  return activity
}

export async function sendEmailMock(payload: SendEmailPayload): Promise<LeadMessage> {
  const id = 'msg' + Date.now()
  const now = new Date().toISOString()
  const queued: LeadMessage = {
    id,
    leadId: payload.leadId,
    type: 'email',
    subject: payload.subject,
    body: payload.body,
    status: 'queued',
    createdAt: now,
    actorUserId: 'u1',
  }
  mockMessages.push(queued)
  emitLeadWs('lead.message.queued', queued)
  // Simulate async send
  setTimeout(() => {
    const idx = mockMessages.findIndex((m) => m.id === id)
    if (idx === -1) return
    const success = Math.random() > 0.2
    mockMessages[idx] = { ...mockMessages[idx], status: success ? 'sent' : 'failed', providerMessageId: success ? 'ext-' + id : undefined }
    emitLeadWs(success ? 'lead.message.sent' : 'lead.message.failed', mockMessages[idx])
  }, 800)
  return queued
}

export async function listTemplatesMock(): Promise<EmailTemplate[]> {
  await delay(100)
  return [...mockTemplates]
}

export async function getTemplateMock(id: string): Promise<EmailTemplate | null> {
  await delay(50)
  return mockTemplates.find((t) => t.id === id) ?? null
}

export async function createTemplateMock(t: Omit<EmailTemplate, 'id' | 'createdAt'>): Promise<EmailTemplate> {
  await delay(150)
  const id = 'tmpl' + Date.now()
  const template: EmailTemplate = { ...t, id, createdAt: new Date().toISOString() }
  mockTemplates.push(template)
  return template
}

export async function updateTemplateMock(id: string, t: Partial<EmailTemplate>): Promise<EmailTemplate | null> {
  await delay(150)
  const idx = mockTemplates.findIndex((x) => x.id === id)
  if (idx === -1) return null
  mockTemplates[idx] = { ...mockTemplates[idx], ...t }
  return mockTemplates[idx]
}

