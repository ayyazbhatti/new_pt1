import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/shared/components/common'
import {
  listSessionTemplates,
  getSessionTemplate,
  createSessionTemplate,
  updateSessionTemplate,
  deleteSessionTemplate,
} from '../api/sessionTemplates.api'
import {
  listTemplateHolidays,
  createTemplateHoliday,
  updateTemplateHoliday,
  deleteTemplateHoliday,
} from '../api/templateHolidays.api'
import type { CreateSessionTemplatePayload, UpdateSessionTemplatePayload, UpsertMarketHolidayPayload } from '../types/sessionTemplate'

export const sessionTemplatesQueryKeys = {
  all: ['sessionTemplates'] as const,
  lists: () => [...sessionTemplatesQueryKeys.all, 'list'] as const,
  list: () => [...sessionTemplatesQueryKeys.lists()] as const,
  detail: (id: string) => [...sessionTemplatesQueryKeys.all, 'detail', id] as const,
  holidays: (templateId: string, year: number) =>
    [...sessionTemplatesQueryKeys.all, 'holidays', templateId, year] as const,
}

export function useSessionTemplatesList(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: sessionTemplatesQueryKeys.list(),
    queryFn: () => listSessionTemplates(),
    enabled: options?.enabled ?? true,
  })
}

export function useSessionTemplate(id: string | null, enabled = true) {
  return useQuery({
    queryKey: sessionTemplatesQueryKeys.detail(id!),
    queryFn: () => getSessionTemplate(id!),
    enabled: enabled && !!id,
  })
}

export function useCreateSessionTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateSessionTemplatePayload) => createSessionTemplate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionTemplatesQueryKeys.lists() })
      toast.success('Session template created')
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error as Error)?.message ||
        'Failed to create template'
      toast.error(message)
    },
  })
}

export function useUpdateSessionTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSessionTemplatePayload }) =>
      updateSessionTemplate(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sessionTemplatesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: sessionTemplatesQueryKeys.detail(variables.id) })
      toast.success('Session template updated')
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error as Error)?.message ||
        'Failed to update template'
      toast.error(message)
    },
  })
}

export function useDeleteSessionTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSessionTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionTemplatesQueryKeys.lists() })
      toast.success('Session template deleted')
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error as Error)?.message ||
        'Failed to delete template'
      toast.error(message)
    },
  })
}

const SESSION_STATUS_KEY = ['session-status'] as const

function invalidateSessionStatusQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: [...SESSION_STATUS_KEY] })
}

export function useTemplateHolidays(templateId: string | null, year: number, enabled = true) {
  return useQuery({
    queryKey: sessionTemplatesQueryKeys.holidays(templateId ?? '', year),
    queryFn: () => listTemplateHolidays(templateId!, year),
    enabled: enabled && !!templateId,
  })
}

export function useCreateTemplateHoliday() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: UpsertMarketHolidayPayload }) =>
      createTemplateHoliday(templateId, payload),
    onSuccess: (_, v) => {
      void queryClient.invalidateQueries({ queryKey: [...sessionTemplatesQueryKeys.all, 'holidays', v.templateId] })
      invalidateSessionStatusQueries(queryClient)
      toast.success('Holiday added')
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error as Error)?.message ||
        'Failed to add holiday'
      toast.error(message)
    },
  })
}

export function useUpdateTemplateHoliday() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ holidayId, payload }: { holidayId: string; templateId: string; payload: UpsertMarketHolidayPayload }) =>
      updateTemplateHoliday(holidayId, payload),
    onSuccess: (_, v) => {
      void queryClient.invalidateQueries({ queryKey: [...sessionTemplatesQueryKeys.all, 'holidays', v.templateId] })
      invalidateSessionStatusQueries(queryClient)
      toast.success('Holiday updated')
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error as Error)?.message ||
        'Failed to update holiday'
      toast.error(message)
    },
  })
}

export function useDeleteTemplateHoliday() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ holidayId, templateId }: { holidayId: string; templateId: string }) =>
      deleteTemplateHoliday(holidayId),
    onSuccess: (_, v) => {
      void queryClient.invalidateQueries({ queryKey: [...sessionTemplatesQueryKeys.all, 'holidays', v.templateId] })
      invalidateSessionStatusQueries(queryClient)
      toast.success('Holiday deleted')
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (error as Error)?.message ||
        'Failed to delete holiday'
      toast.error(message)
    },
  })
}
