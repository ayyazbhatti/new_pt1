import { http } from '@/shared/api/http'

/** Backend response (snake_case) */
export interface AffiliateUserDto {
  id: string
  email: string
  first_name: string
  last_name: string
  referral_code: string | null
  referred_count: number
  level: number
  commission_percent: number
}

export interface AffiliateUser {
  id: string
  email: string
  firstName: string
  lastName: string
  referralCode: string | null
  referredCount: number
  level: number
  commissionPercent: number
}

function fromDto(d: AffiliateUserDto): AffiliateUser {
  return {
    id: d.id,
    email: d.email,
    firstName: d.first_name,
    lastName: d.last_name,
    referralCode: d.referral_code,
    referredCount: d.referred_count,
    level: d.level,
    commissionPercent: d.commission_percent,
  }
}

export async function listAffiliateUsers(): Promise<AffiliateUser[]> {
  const list = await http<AffiliateUserDto[]>('/api/admin/affiliate/users', {
    method: 'GET',
  })
  return list.map(fromDto)
}
