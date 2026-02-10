import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { UserKPICards, UserFiltersBar, UsersTable } from '../components'
import { useModalStore } from '@/app/store'
import { CreateEditUserModal } from '../modals/CreateEditUserModal'
import { Download, Plus } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listUsers, UserResponse } from '@/shared/api/users.api'
import { User } from '../types/users'

// Map backend user to frontend User type
function mapUserResponse(user: UserResponse): User {
  return {
    id: user.id,
    name: `${user.first_name} ${user.last_name}`,
    email: user.email,
    phone: user.phone || undefined,
    country: user.country || 'Unknown',
    group: user.group_id || '',
    groupName: user.group_name || 'No Group',
    balance: 0, // TODO: Calculate from wallets table
    marginLevel: 0, // TODO: Calculate from positions
    status: user.status as 'active' | 'disabled' | 'suspended',
    kycStatus: 'none', // TODO: Get from KYC table
    riskFlag: 'normal', // TODO: Get from risk table
    createdAt: user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString(),
    lastLogin: user.last_login_at ? new Date(user.last_login_at).toISOString() : undefined,
    affiliateCode: user.referral_code || undefined,
    leverageLimitMin: 1, // TODO: Get from user_groups
    leverageLimitMax: 500, // TODO: Get from user_groups
    currentExposure: 0, // TODO: Calculate from positions
    openPositions: 0, // TODO: Count from positions table
    ordersCount: 0, // TODO: Count from orders table
    priceStreamProfile: 'Default', // TODO: Get from price_stream_profiles
    tradingEnabled: true, // TODO: Get from user_groups
    closeOnlyMode: false, // TODO: Get from user_groups
    withdrawalsEnabled: true, // TODO: Get from user_groups
    depositsEnabled: true, // TODO: Get from user_groups
    maxLeverageCap: 500, // TODO: Get from user_groups
    maxPositionSize: 0, // TODO: Get from user_groups
    maxDailyLoss: 0, // TODO: Get from risk settings
  }
}

export function AdminUsersPage() {
  const openModal = useModalStore((state) => state.openModal)
  
  // Fetch real users from API
  const { data: usersData, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers({ limit: 100 }),
  })
  
  const [usersState, setUsersState] = useState<User[]>([])

  const users = useMemo(() => {
    if (!usersData) return []
    const mappedUsers = usersData.map(mapUserResponse)
    // Update state when data changes
    if (mappedUsers.length > 0 && usersState.length === 0) {
      setUsersState(mappedUsers)
    }
    return mappedUsers
  }, [usersData, usersState.length])

  const handleUserUpdate = (userId: string, updates: Partial<User>) => {
    setUsersState((prev) =>
      prev.map((user) => (user.id === userId ? { ...user, ...updates } : user))
    )
  }
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    kycStatus: 'all',
    group: 'all',
    country: 'all',
    balanceMin: '',
    balanceMax: '',
  })

  // Use state if available, otherwise use computed users
  const displayUsers = usersState.length > 0 ? usersState : users

  const filteredUsers = useMemo(() => {
    return displayUsers.filter((user) => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        if (
          !user.name.toLowerCase().includes(searchLower) &&
          !user.email.toLowerCase().includes(searchLower) &&
          !user.id.toLowerCase().includes(searchLower)
        ) {
          return false
        }
      }
      if (filters.status !== 'all' && user.status !== filters.status) return false
      if (filters.kycStatus !== 'all' && user.kycStatus !== filters.kycStatus) return false
      if (filters.group !== 'all' && user.group !== filters.group) return false
      if (filters.country !== 'all' && user.country !== filters.country) return false
      if (filters.balanceMin) {
        const min = parseFloat(filters.balanceMin)
        if (user.balance < min) return false
      }
      if (filters.balanceMax) {
        const max = parseFloat(filters.balanceMax)
        if (user.balance > max) return false
      }
      return true
    })
  }, [displayUsers, filters])

  const handleCreateUser = () => {
    openModal('create-user', <CreateEditUserModal />, {
      title: 'Create User',
      size: 'md',
    })
  }

  const handleExport = () => {
    toast.success('Export functionality coming soon')
  }

  if (isLoading) {
    return (
      <ContentShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading users...</div>
        </div>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-danger mb-2">Failed to load users</div>
            <div className="text-sm text-text-muted">{error instanceof Error ? error.message : 'Unknown error'}</div>
          </div>
        </div>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Users"
        description="Manage client accounts, trading permissions, KYC, risk status, and groups."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button onClick={handleCreateUser}>
              <Plus className="h-4 w-4 mr-2" />
              Create User
            </Button>
          </div>
        }
      />
      <UserKPICards users={displayUsers} />
      <UserFiltersBar filters={filters} onFilterChange={setFilters} />
      <UsersTable users={filteredUsers} onUserUpdate={handleUserUpdate} />
    </ContentShell>
  )
}

