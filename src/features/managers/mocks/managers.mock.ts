import type { Manager, UserOption } from '../types/manager'

export const mockManagers: Manager[] = [
  {
    id: 'mgr-1',
    userId: 'user-1',
    userName: 'Jane Smith',
    userEmail: 'jane.smith@example.com',
    role: 'manager',
    permissionProfileId: 'profile-leads',
    permissionProfileName: 'Leads Manager',
    status: 'active',
    createdAt: '2025-01-15T10:00:00Z',
    lastLoginAt: '2025-02-20T14:30:00Z',
    notes: 'Handles EU leads',
  },
  {
    id: 'mgr-2',
    userId: 'user-2',
    userName: 'John Doe',
    userEmail: 'john.doe@example.com',
    role: 'manager',
    permissionProfileId: 'profile-support',
    permissionProfileName: 'Support Manager',
    status: 'active',
    createdAt: '2025-01-20T09:00:00Z',
    lastLoginAt: '2025-02-21T08:15:00Z',
  },
  {
    id: 'mgr-3',
    userId: 'user-3',
    userName: 'Alice Brown',
    userEmail: 'alice.brown@example.com',
    role: 'manager',
    permissionProfileId: 'profile-full',
    permissionProfileName: 'Full Admin',
    status: 'disabled',
    createdAt: '2024-12-01T12:00:00Z',
    lastLoginAt: '2025-01-10T11:00:00Z',
    notes: 'Temporarily disabled',
  },
]

/** Users that are not yet managers (for "Create Manager" → Select user dropdown). Static list for demo. */
export const mockUsersAvailableForManager: UserOption[] = [
  { id: 'user-4', name: 'Bob Wilson', email: 'bob.wilson@example.com' },
  { id: 'user-5', name: 'Carol Davis', email: 'carol.davis@example.com' },
  { id: 'user-6', name: 'David Lee', email: 'david.lee@example.com' },
]
