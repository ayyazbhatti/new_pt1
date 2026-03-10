import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { UserKPICards, UserFiltersBar, UsersTable } from '../components'
import { useModalStore } from '@/app/store'
import { CreateEditUserModal, MultiUserMetricsModal } from '../modals'
import { Download, Plus, Activity } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { useState, useMemo, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { listUsers, UserResponse } from '@/shared/api/users.api'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
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
    accountType: (user.account_type === 'netting' ? 'netting' : 'hedging') as 'hedging' | 'netting',
    marginCalculationType: (user.margin_calculation_type === 'net' ? 'net' : 'hedged') as 'hedged' | 'net',
    tradingAccess: (user.trading_access === 'close_only' ? 'close_only' : user.trading_access === 'disabled' ? 'disabled' : 'full') as 'full' | 'close_only' | 'disabled',
    openPositionsCount: user.open_positions_count ?? 0,
    balance: 0, // TODO: Calculate from wallets table
    marginLevel: 0, // TODO: Calculate from positions
    status: user.status as 'active' | 'disabled' | 'suspended',
    kycStatus: 'none', // TODO: Get from KYC table
    riskFlag: 'normal', // TODO: Get from risk table
    createdAt: user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString(),
    lastLogin: user.last_login_at ? new Date(user.last_login_at).toISOString() : undefined,
    affiliateCode: user.referral_code || undefined,
    leverageLimitMin: user.min_leverage ?? 1,
    leverageLimitMax: user.max_leverage ?? 500,
    currentExposure: 0, // TODO: Calculate from positions
    openPositions: user.open_positions_count ?? 0,
    ordersCount: 0, // TODO: Count from orders table
    priceStreamProfile: 'Default', // TODO: Get from price_stream_profiles
    tradingEnabled: true, // TODO: Get from user_groups
    closeOnlyMode: false, // TODO: Get from user_groups
    withdrawalsEnabled: true, // TODO: Get from user_groups
    depositsEnabled: true, // TODO: Get from user_groups
    maxLeverageCap: 500, // TODO: Get from user_groups
    maxPositionSize: 0, // TODO: Get from user_groups
    maxDailyLoss: 0, // TODO: Get from risk settings
    permissionProfileId: user.permission_profile_id ?? undefined,
    permissionProfileName: user.permission_profile_name ?? undefined,
    role: user.role,
  }
}

export function AdminUsersPage() {
  const openModal = useModalStore((state) => state.openModal)
  const canCreateUser = useCanAccess('users:create')

  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    kycStatus: 'all',
    group: 'all',
    country: 'all',
    balanceMin: '',
    balanceMax: '',
  })

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // Debounce search so we don't refetch on every keystroke (no blink, professional UX)
  const debouncedSearch = useDebouncedValue(filters.search, 400)
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  // Server-side pagination and filtering (supports 1M+ users)
  const { data: usersData, isLoading, error, isFetching } = useQuery({
    queryKey: [
      'users',
      page,
      pageSize,
      debouncedSearch,
      filters.status,
      filters.group,
    ],
    queryFn: () =>
      listUsers({
        page,
        page_size: pageSize,
        search: debouncedSearch.trim() || undefined,
        status: filters.status !== 'all' ? filters.status : undefined,
        group_id: filters.group !== 'all' ? filters.group : undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const users = useMemo(
    () => (usersData?.items ?? []).map(mapUserResponse),
    [usersData?.items]
  )
  const total = usersData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)

  const [usersState, setUsersState] = useState<User[]>([])
  useEffect(() => {
    if (users.length > 0) setUsersState(users)
  }, [users])
  const displayUsers = usersState.length > 0 ? usersState : users

  const handleUserUpdate = (userId: string, updates: Partial<User>) => {
    setUsersState((prev) =>
      prev.map((user) => (user.id === userId ? { ...user, ...updates } : user))
    )
  }

  useEffect(() => {
    setPage(1)
  }, [filters.status, filters.group])

  const handlePageChange = (newPage: number) => {
    setPage(Math.max(1, Math.min(newPage, totalPages)))
  }

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(1)
  }

  const handleCreateUser = () => {
    openModal('create-user', <CreateEditUserModal />, {
      title: 'Create User',
      size: 'md',
    })
  }

  const handleExport = () => {
    toast.success('Export functionality coming soon')
  }

  const [multiUserMetricsOpen, setMultiUserMetricsOpen] = useState(false)

  // Full-page loading only on initial load (no data yet). Refetches keep previous data visible.
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

  const isInitialLoading = isLoading && !usersData

  return (
    <ContentShell>
      {isInitialLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading users...</div>
        </div>
      )}
      {!isInitialLoading && (
        <>
      <PageHeader
        title="Users"
        description="Manage client accounts, trading permissions, KYC, risk status, and groups."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setMultiUserMetricsOpen(true)}
              className="hidden sm:inline-flex"
            >
              <Activity className="h-4 w-4 mr-2" />
              Multi-User Metrics
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMultiUserMetricsOpen(true)}
              className="sm:hidden"
              title="Metrics"
            >
              <Activity className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            {canCreateUser && (
              <Button onClick={handleCreateUser}>
                <Plus className="h-4 w-4 mr-2" />
                Create User
              </Button>
            )}
          </div>
        }
      />
      <UserKPICards users={displayUsers} totalFromServer={total} />
      <div className="relative">
        {isFetching && (
          <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 rounded bg-surface-2/90 px-2 py-1 text-xs text-text-muted">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
            Updating…
          </div>
        )}
        <UserFiltersBar filters={filters} onFilterChange={setFilters} />
      </div>
      <UsersTable
        users={displayUsers}
        onUserUpdate={handleUserUpdate}
        pagination={{
          page: currentPage,
          pageSize,
          total,
          onPageChange: handlePageChange,
          onPageSizeChange: handlePageSizeChange,
        }}
      />
      <MultiUserMetricsModal
        open={multiUserMetricsOpen}
        onOpenChange={setMultiUserMetricsOpen}
      />
        </>
      )}
    </ContentShell>
  )
}

