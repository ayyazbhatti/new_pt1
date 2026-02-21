import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadQueryKeys } from '../api/leads.ws'
import * as api from '../api/leads.api'
import type { EmailTemplate } from '../types/leads.types'

export function useTemplates() {
  return useQuery({
    queryKey: leadQueryKeys.templates(),
    queryFn: api.listTemplates,
  })
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: [...leadQueryKeys.templates(), id],
    queryFn: () => (id ? api.getTemplate(id) : Promise.resolve(null)),
    enabled: !!id,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: Omit<EmailTemplate, 'id' | 'createdAt'>) => api.createTemplate(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: leadQueryKeys.templates() }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmailTemplate> }) => api.updateTemplate(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: leadQueryKeys.templates() }),
  })
}
