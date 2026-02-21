import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { wsClient } from '@/shared/ws/wsClient'

export const leadQueryKeys = {
  all: ['leads'] as const,
  list: (params: object) => [...leadQueryKeys.all, 'list', params] as const,
  detail: (id: string) => [...leadQueryKeys.all, 'detail', id] as const,
  stages: () => [...leadQueryKeys.all, 'stages'] as const,
  activities: (leadId: string) => [...leadQueryKeys.all, 'detail', leadId, 'activities'] as const,
  tasks: (leadId: string) => [...leadQueryKeys.all, 'detail', leadId, 'tasks'] as const,
  messages: (leadId: string) => [...leadQueryKeys.all, 'detail', leadId, 'messages'] as const,
  templates: () => [...leadQueryKeys.all, 'templates'] as const,
  taskList: (userId?: string) => [...leadQueryKeys.all, 'taskList', userId] as const,
}

function handleLeadEvent(eventType: string, payload: unknown, queryClient: ReturnType<typeof useQueryClient>) {
  const p = payload as Record<string, unknown>
  const leadIdFromPayload = (): string | undefined => {
    const lead = p.lead as Record<string, unknown> | undefined
    if (lead?.id != null) return String(lead.id)
    if (p.lead_id != null) return String(p.lead_id)
    if (p.leadId != null) return String(p.leadId)
    return undefined
  }

  switch (eventType) {
    case 'leads.created':
    case 'leads.updated':
    case 'leads.assigned':
    case 'leads.stage_changed': {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all })
      const leadId = leadIdFromPayload()
      if (leadId) queryClient.invalidateQueries({ queryKey: leadQueryKeys.detail(leadId) })
      break
    }
    case 'leads.deleted': {
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all })
      const leadId = (p.lead_id ?? p.leadId) as string | undefined
      if (leadId) queryClient.removeQueries({ queryKey: leadQueryKeys.detail(leadId) })
      break
    }
    case 'leads.task.created':
    case 'leads.task.completed': {
      const leadId = (p.lead_id ?? p.leadId) as string | undefined
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.tasks(leadId) })
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.detail(leadId) })
      }
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: [...leadQueryKeys.all, 'taskList'] })
      break
    }
    case 'leads.activity.added': {
      const leadId = (p.lead_id ?? p.leadId) as string | undefined
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.activities(leadId) })
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.detail(leadId) })
      }
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all })
      break
    }
    case 'leads.email.queued':
    case 'leads.email.sent':
    case 'leads.email.failed': {
      const leadId = (p.lead_id ?? p.leadId) as string | undefined
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.messages(leadId) })
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.detail(leadId) })
      }
      break
    }
    default:
      break
  }
}

/**
 * Subscribes to lead-related WebSocket events from the gateway (leads.*) and invalidates
 * React Query caches so UI updates in realtime.
 */
export function useLeadRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsub = wsClient.subscribe((event) => {
      const type = (event as { type?: string }).type
      if (typeof type === 'string' && type.startsWith('leads.')) {
        const payload = (event as { payload?: unknown }).payload
        handleLeadEvent(type, payload, queryClient)
      }
    })
    return unsub
  }, [queryClient])
}
