import { useQuery } from '@tanstack/react-query'
import { getMyReferrals } from '@/shared/api/auth.api'

export const myReferralsQueryKey = ['user', 'affiliate', 'referrals'] as const

export function useMyReferrals() {
  return useQuery({
    queryKey: myReferralsQueryKey,
    queryFn: getMyReferrals,
  })
}
