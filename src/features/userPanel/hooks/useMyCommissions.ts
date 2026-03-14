import { useQuery } from '@tanstack/react-query'
import { getMyCommissions } from '@/shared/api/auth.api'

export const myCommissionsQueryKey = ['user', 'affiliate', 'commissions'] as const

export function useMyCommissions() {
  return useQuery({
    queryKey: myCommissionsQueryKey,
    queryFn: getMyCommissions,
  })
}
