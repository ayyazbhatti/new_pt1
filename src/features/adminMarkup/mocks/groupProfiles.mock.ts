import { GroupPriceProfile } from '../types/pricing'
import { mockGroups } from '@/features/groups/mocks/groups.mock'
import { mockPriceProfiles } from './priceProfiles.mock'

export const mockGroupProfiles: GroupPriceProfile[] = [
  {
    groupId: '1',
    groupName: 'Standard Group',
    profileId: 'profile-1',
    profileName: 'Standard Retail',
    notes: 'Default retail pricing',
  },
  {
    groupId: '2',
    groupName: 'VIP Group',
    profileId: 'profile-2',
    profileName: 'VIP Low Spread',
    notes: 'VIP clients get tight spreads',
  },
  {
    groupId: '3',
    groupName: 'Restricted Group',
    profileId: 'profile-3',
    profileName: 'High Spread Premium',
    notes: 'High-risk group with premium markup',
  },
]

