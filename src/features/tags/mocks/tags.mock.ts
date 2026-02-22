import type { Tag } from '../types/tag'

export const mockTags: Tag[] = [
  {
    id: '1',
    name: 'VIP',
    slug: 'vip',
    color: '#8b5cf6',
    description: 'High-value clients',
    userCount: 12,
    managerCount: 0,
    createdAt: '2025-01-15T10:00:00Z',
  },
  {
    id: '2',
    name: 'High Risk',
    slug: 'high-risk',
    color: '#ef4444',
    description: 'Requires extra monitoring',
    userCount: 5,
    managerCount: 2,
    createdAt: '2025-01-20T14:30:00Z',
  },
  {
    id: '3',
    name: 'New Trader',
    slug: 'new-trader',
    color: '#22c55e',
    description: 'Recently onboarded',
    userCount: 48,
    managerCount: 0,
    createdAt: '2025-02-01T09:00:00Z',
  },
  {
    id: '4',
    name: 'Inactive',
    slug: 'inactive',
    color: '#64748b',
    userCount: 120,
    managerCount: 0,
    createdAt: '2025-01-10T08:00:00Z',
  },
]
