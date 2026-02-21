import { useQuery } from '@tanstack/react-query'
import { leadQueryKeys } from '../api/leads.ws'
import * as api from '../api/leads.api'

export function useLeadById(id: string | null) {
  return useQuery({
    queryKey: leadQueryKeys.detail(id ?? ''),
    queryFn: () => (id ? api.getLead(id) : Promise.resolve(null)),
    enabled: !!id,
  })
}

export function useLeadActivities(leadId: string | null) {
  return useQuery({
    queryKey: leadQueryKeys.activities(leadId ?? ''),
    queryFn: () => (leadId ? api.getLeadActivities(leadId) : Promise.resolve([])),
    enabled: !!leadId,
  })
}

export function useLeadTasks(leadId: string | null) {
  return useQuery({
    queryKey: leadQueryKeys.tasks(leadId ?? ''),
    queryFn: () => (leadId ? api.getLeadTasks(leadId) : Promise.resolve([])),
    enabled: !!leadId,
  })
}

export function useLeadMessages(leadId: string | null) {
  return useQuery({
    queryKey: leadQueryKeys.messages(leadId ?? ''),
    queryFn: () => (leadId ? api.getLeadMessages(leadId) : Promise.resolve([])),
    enabled: !!leadId,
  })
}
