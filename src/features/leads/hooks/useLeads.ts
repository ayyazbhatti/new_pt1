import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ListLeadsParams } from '../types/leads.types'
import { leadQueryKeys } from '../api/leads.ws'
import * as api from '../api/leads.api'

export function useLeads(params: ListLeadsParams) {
  return useQuery({
    queryKey: leadQueryKeys.list(params),
    queryFn: () => api.listLeads(params),
  })
}

export function useCreateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createLead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}

export function useUpdateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof api.updateLead>[1] }) =>
      api.updateLead(id, payload),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.detail(id) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}

export function useAssignLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ownerUserId }: { id: string; ownerUserId: string }) => api.assignLead(id, ownerUserId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.detail(id) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}

export function useChangeStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) => api.changeStage(id, stageId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: leadQueryKeys.detail(id) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}

export function useDeleteLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteLead,
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: leadQueryKeys.detail(id) })
      qc.invalidateQueries({ queryKey: leadQueryKeys.all })
    },
  })
}
