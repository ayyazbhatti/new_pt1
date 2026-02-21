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
import { http } from '@/shared/api/http'
import {
  mapLead,
  mapStage,
  mapActivity,
  mapTask,
  mapMessage,
  mapTemplate,
  listLeadsQuery,
  createLeadBody,
} from './leadsApi.mapper'
import * as mock from './leads.mock'

/** True if we should fall back to mock (502, 401, or connection error). */
function shouldFallbackToMock(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  const message = (err as Error)?.message ?? ''
  return (
    status === 502 ||
    status === 401 ||
    /fetch|network|failed|ECONNREFUSED|Unauthorized/i.test(message)
  )
}

export {
  listLeadsMock,
  getLeadMock,
  createLeadMock,
  updateLeadMock,
  assignLeadMock,
  changeStageMock,
  deleteLeadMock,
  listStagesMock,
  getLeadActivitiesMock,
  getLeadTasksMock,
  getLeadMessagesMock,
  createTaskMock,
  completeTaskMock,
  logCallMock,
  sendEmailMock,
  listTemplatesMock,
  getTemplateMock,
  createTemplateMock,
  updateTemplateMock,
  subscribeLeadWs,
} from './leads.mock'

export async function listLeads(params: ListLeadsParams): Promise<{ items: Lead[]; total: number }> {
  try {
    const query = listLeadsQuery({
      page: params.page,
      pageSize: params.pageSize,
      status: params.status,
      stageId: params.stageId,
      ownerUserId: params.ownerUserId,
      search: params.search,
      source: params.source,
      country: params.country,
      scoreMin: params.scoreMin,
      scoreMax: params.scoreMax,
    })
    const res = (await http<{ items: unknown[]; total: number }>(`/api/leads${query}`)) as {
      items: Record<string, unknown>[]
      total: number
    }
    return {
      items: (res.items || []).map(mapLead),
      total: res.total ?? 0,
    }
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.listLeadsMock(params)
    throw err
  }
}

export async function getLead(id: string): Promise<Lead | null> {
  try {
    const res = (await http<Record<string, unknown>>(`/api/leads/${id}`)) as Record<string, unknown>
    return mapLead(res)
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return null
    if (shouldFallbackToMock(err)) return mock.getLeadMock(id)
    throw err
  }
}

export async function createLead(payload: CreateLeadPayload): Promise<Lead> {
  try {
    const body = createLeadBody(payload)
    const res = (await http<Record<string, unknown>>('/api/leads', {
      method: 'POST',
      body: JSON.stringify(body),
    })) as Record<string, unknown>
    return mapLead(res)
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.createLeadMock(payload)
    throw err
  }
}

export async function updateLead(id: string, payload: UpdateLeadPayload): Promise<Lead | null> {
  return mock.updateLeadMock(id, payload)
}

export async function assignLead(id: string, ownerUserId: string): Promise<Lead | null> {
  return mock.assignLeadMock(id, ownerUserId)
}

export async function changeStage(id: string, stageId: string): Promise<Lead | null> {
  return mock.changeStageMock(id, stageId)
}

export async function deleteLead(id: string): Promise<boolean> {
  return mock.deleteLeadMock(id)
}

export async function listStages(): Promise<LeadStage[]> {
  try {
    const res = (await http<unknown[]>('/api/lead-stages')) as Record<string, unknown>[]
    return (res || []).map(mapStage)
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.listStagesMock()
    throw err
  }
}

export async function getLeadActivities(leadId: string): Promise<LeadActivity[]> {
  try {
    const res = (await http<unknown[]>(`/api/leads/${leadId}/activities`)) as Record<string, unknown>[]
    return (res || []).map(mapActivity)
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.getLeadActivitiesMock(leadId)
    throw err
  }
}

export async function getLeadTasks(leadId: string): Promise<LeadTask[]> {
  try {
    const res = (await http<unknown[]>(`/api/leads/${leadId}/tasks`)) as Record<string, unknown>[]
    return (res || []).map(mapTask)
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.getLeadTasksMock(leadId)
    throw err
  }
}

export async function getLeadMessages(leadId: string): Promise<LeadMessage[]> {
  try {
    const res = (await http<unknown[]>(`/api/leads/${leadId}/messages`)) as Record<string, unknown>[]
    return (res || []).map(mapMessage)
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.getLeadMessagesMock(leadId)
    throw err
  }
}

export type { TaskWithLead } from './leads.mock'
export async function listTasks(assignedToUserId?: string) {
  return mock.listTasksMock(assignedToUserId)
}

export async function createTask(payload: CreateTaskPayload): Promise<LeadTask> {
  return mock.createTaskMock(payload)
}

export async function completeTask(taskId: string, notes?: string): Promise<LeadTask | null> {
  return mock.completeTaskMock(taskId, notes)
}

export async function logCall(payload: LogCallPayload): Promise<LeadActivity> {
  return mock.logCallMock(payload)
}

export async function sendEmail(payload: SendEmailPayload): Promise<LeadMessage> {
  return mock.sendEmailMock(payload)
}

export async function listTemplates(): Promise<EmailTemplate[]> {
  try {
    const res = (await http<unknown[]>('/api/email-templates')) as Record<string, unknown>[]
    return (res || []).map(mapTemplate)
  } catch (err) {
    if (shouldFallbackToMock(err)) return mock.listTemplatesMock()
    throw err
  }
}

export async function getTemplate(id: string): Promise<EmailTemplate | null> {
  return mock.getTemplateMock(id)
}

export async function createTemplate(t: Omit<EmailTemplate, 'id' | 'createdAt'>): Promise<EmailTemplate> {
  return mock.createTemplateMock(t)
}

export async function updateTemplate(id: string, t: Partial<EmailTemplate>): Promise<EmailTemplate | null> {
  return mock.updateTemplateMock(id, t)
}
