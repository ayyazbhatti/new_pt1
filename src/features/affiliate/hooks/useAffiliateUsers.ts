import { useQuery } from '@tanstack/react-query'
import { listAffiliateUsers } from '../api/affiliateUsers.api'

export const affiliateUsersQueryKey = ['affiliate', 'users'] as const

export function useAffiliateUsers() {
  return useQuery({
    queryKey: affiliateUsersQueryKey,
    queryFn: listAffiliateUsers,
  })
}
