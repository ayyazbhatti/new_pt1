import { useMutation, useQueryClient } from '@tanstack/react-query'
import { leadQueryKeys } from '../api/leads.ws'
import * as api from '../api/leads.api'
import type { CreateTaskPayload } from '../types/leads.types'

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateTaskPayload) => api.createTask(payload),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.tasks(variables.leadId) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.detail(variables.leadId) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}

export function useCompleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, notes }: { taskId: string; notes?: string }) => api.completeTask(taskId, notes),
    onSuccess: (data) => {
      if (data?.leadId) {
        qc.invalidateQueries({ queryKey: leadQueryKeys.tasks(data.leadId) })
        qc.invalidateQueries({ queryKey: leadQueryKeys.detail(data.leadId) })
      }
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}
