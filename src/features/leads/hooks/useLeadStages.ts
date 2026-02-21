import { useQuery } from '@tanstack/react-query'
import { leadQueryKeys } from '../api/leads.ws'
import * as api from '../api/leads.api'

export function useLeadStages() {
  return useQuery({
    queryKey: leadQueryKeys.stages(),
    queryFn: api.listStages,
  })
}
