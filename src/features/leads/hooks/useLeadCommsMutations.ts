import { useMutation, useQueryClient } from '@tanstack/react-query'
import { leadQueryKeys } from '../api/leads.ws'
import * as api from '../api/leads.api'
import type { LogCallPayload, SendEmailPayload } from '../types/leads.types'

export function useLogCall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: LogCallPayload) => api.logCall(payload),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.activities(variables.leadId) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.detail(variables.leadId) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}

export function useSendEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SendEmailPayload) => api.sendEmail(payload),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.messages(variables.leadId) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.detail(variables.leadId) })
    },
  })
}
