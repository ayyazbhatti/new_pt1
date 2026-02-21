import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { User } from '../types/users'
import { useModalStore } from '@/app/store'
import { UserDetailsModal } from '../modals/UserDetailsModal'
import { CreateEditUserModal } from '../modals/CreateEditUserModal'
import { RestrictUserModal } from '../modals/RestrictUserModal'
import { Eye, Edit, Shield, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import { useCanAccess } from '@/shared/utils/permissions'
import { updateUserGroup, updateUserAccountType, updateUserMarginCalculationType, updateUserTradingAccess } from '../api/users.api'

interface UsersTableProps {
  users: User[]
  onUserUpdate?: (userId: string, updates: Partial<User>) => void
}

export function UsersTable({ users, onUserUpdate }: UsersTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const canEditUser = useCanAccess('users:edit')
  const [updatingGroups, setUpdatingGroups] = useState<Set<string>>(new Set())
  const [updatingAccountTypes, setUpdatingAccountTypes] = useState<Set<string>>(new Set())
  const [updatingMarginCalculationTypes, setUpdatingMarginCalculationTypes] = useState<Set<string>>(new Set())
  const [updatingTradingAccess, setUpdatingTradingAccess] = useState<Set<string>>(new Set())

  // Fetch all groups for the dropdown
  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page: 1,
    page_size: 500,
  })

  const apiGroups = groupsData?.items ?? []

  // Fallback: build list from groups assigned to users on this page (so dropdown always has options even if API fails)
  const groupsFromUsers = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; name: string }[] = []
    for (const u of users) {
      if (u.group && u.groupName && !seen.has(u.group)) {
        seen.add(u.group)
        list.push({ id: u.group, name: u.groupName })
      }
    }
    return list
  }, [users])

  // Merge API groups with groups-from-users so we always show all options (API may return empty)
  const groups = useMemo(() => {
    const merged = apiGroups.length > 0 ? [...apiGroups] : []
    for (const g of groupsFromUsers) {
      if (!merged.some((m) => m.id === g.id)) {
        merged.push(g as (typeof merged)[0])
      }
    }
    return merged.length > 0 ? merged : groupsFromUsers
  }, [apiGroups, groupsFromUsers])

  const handleGroupChange = async (userId: string, userName: string, newGroupId: string) => {
    const selectedGroup = groups.find((g) => g.id === newGroupId)
    if (!selectedGroup) return

    setUpdatingGroups((prev) => new Set(prev).add(userId))

    try {
      await updateUserGroup(userId, { group_id: newGroupId })
      
      // Update local state
      if (onUserUpdate) {
        onUserUpdate(userId, {
          group: newGroupId,
          groupName: selectedGroup.name,
        })
      }

      toast.success(`User ${userName} group changed to ${selectedGroup.name}`)
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to update user group'
      toast.error(errorMessage)
    } finally {
      setUpdatingGroups((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleAccountTypeChange = async (
    userId: string,
    userName: string,
    newAccountType: 'hedging' | 'netting'
  ) => {
    setUpdatingAccountTypes((prev) => new Set(prev).add(userId))
    try {
      await updateUserAccountType(userId, { account_type: newAccountType })
      if (onUserUpdate) {
        onUserUpdate(userId, { accountType: newAccountType })
      }
      toast.success(`User ${userName} account type changed to ${newAccountType === 'hedging' ? 'Hedging' : 'Netting'}`)
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.error?.message || error?.message || 'Failed to update account type'
      toast.error(errorMessage)
    } finally {
      setUpdatingAccountTypes((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleMarginCalculationTypeChange = async (
    userId: string,
    userName: string,
    newMarginType: 'hedged' | 'net'
  ) => {
    setUpdatingMarginCalculationTypes((prev) => new Set(prev).add(userId))
    try {
      await updateUserMarginCalculationType(userId, { margin_calculation_type: newMarginType })
      if (onUserUpdate) {
        onUserUpdate(userId, { marginCalculationType: newMarginType })
      }
      toast.success(`Margin for ${userName} set to ${newMarginType === 'net' ? 'Net (per symbol)' : 'Sum (all positions)'}`)
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.error?.message || error?.message || 'Failed to update margin calculation type'
      toast.error(errorMessage)
    } finally {
      setUpdatingMarginCalculationTypes((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleTradingAccessChange = async (
    userId: string,
    userName: string,
    newAccess: 'full' | 'close_only' | 'disabled'
  ) => {
    setUpdatingTradingAccess((prev) => new Set(prev).add(userId))
    try {
      await updateUserTradingAccess(userId, { trading_access: newAccess })
      if (onUserUpdate) {
        onUserUpdate(userId, { tradingAccess: newAccess })
      }
      const label = newAccess === 'full' ? 'Full access' : newAccess === 'close_only' ? 'Close only' : 'Trading disabled'
      toast.success(`Trading access for ${userName} set to ${label}`)
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.error?.message || error?.message || 'Failed to update trading access'
      toast.error(errorMessage)
    } finally {
      setUpdatingTradingAccess((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleView = (user: User) => {
    openModal(`user-details-${user.id}`, <UserDetailsModal user={user} />, {
      title: `User Details - ${user.name}`,
      size: 'xl',
    })
  }

  const handleEdit = (user: User) => {
    openModal(
      `edit-user-${user.id}`,
      <CreateEditUserModal user={user} onUserUpdate={onUserUpdate} />,
      { title: 'Edit User', size: 'md' }
    )
  }

  const handleRestrict = (user: User) => {
    openModal(`restrict-user-${user.id}`, <RestrictUserModal user={user} />, {
      title: 'Restrict User',
      size: 'sm',
    })
  }

  const handleDisable = (user: User) => {
    toast.success(`User ${user.name} ${user.status === 'active' ? 'disabled' : 'enabled'}`)
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'danger' | 'neutral'> = {
      active: 'success',
      disabled: 'neutral',
      suspended: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
  }

  const getKYCBadge = (kycStatus: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
      verified: 'success',
      pending: 'warning',
      rejected: 'danger',
      none: 'neutral',
    }
    const labels: Record<string, string> = {
      none: 'Not Submitted',
      pending: 'Pending',
      verified: 'Verified',
      rejected: 'Rejected',
    }
    return <Badge variant={variants[kycStatus] || 'neutral'}>{labels[kycStatus] || kycStatus}</Badge>
  }

  const getRiskBadge = (riskFlag: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger'> = {
      normal: 'success',
      review: 'warning',
      high: 'danger',
    }
    const labels: Record<string, string> = {
      normal: 'Normal',
      review: 'Under Review',
      high: 'High Risk',
    }
    return <Badge variant={variants[riskFlag] || 'neutral'}>{labels[riskFlag] || riskFlag}</Badge>
  }

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'id',
      header: 'User ID',
      cell: ({ row }) => {
        return <span className="font-mono text-sm whitespace-nowrap">{row.getValue('id')}</span>
      },
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        return <span className="font-semibold text-text whitespace-nowrap">{row.getValue('name')}</span>
      },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted whitespace-nowrap">{row.getValue('email')}</span>
      },
    },
    {
      accessorKey: 'groupName',
      header: 'Group',
      cell: ({ row }) => {
        const user = row.original
        const currentGroupId = user.group || ''
        const currentGroupName = user.groupName || ''
        const isUpdating = updatingGroups.has(user.id)
        // Always show ALL groups in the dropdown; add current group at top only if missing from the list
        const groupOptions =
          currentGroupId && !groups.some((g) => g.id === currentGroupId)
            ? [{ id: currentGroupId, name: currentGroupName || 'Unknown group' }, ...groups]
            : groups
        const displayLabel =
          currentGroupName ||
          (currentGroupId ? groupOptions.find((g) => g.id === currentGroupId)?.name : null) ||
          null

        return (
          <div className="whitespace-nowrap min-w-[150px]">
            <Select
              value={currentGroupId || undefined}
              onValueChange={(value) => handleGroupChange(user.id, user.name, value)}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue
                  placeholder={
                    isUpdating ? 'Updating...' : groupsLoading ? 'Loading...' : 'Select group'
                  }
                >
                  {displayLabel ?? undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {groupOptions.length === 0 && !groupsLoading && (
                  <SelectItem value="no-groups" disabled>No groups available</SelectItem>
                )}
                {groupOptions.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      },
    },
    {
      accessorKey: 'accountType',
      header: 'Account Type',
      cell: ({ row }) => {
        const user = row.original
        const currentType = user.accountType ?? 'hedging'
        const isUpdating = updatingAccountTypes.has(user.id)
        const hasOpenPositions = (user.openPositionsCount ?? 0) > 0
        const disabled = isUpdating || hasOpenPositions
        return (
          <div className="whitespace-nowrap min-w-[130px]">
            <Select
              value={currentType}
              onValueChange={(value) =>
                handleAccountTypeChange(user.id, user.name, value as 'hedging' | 'netting')
              }
              disabled={disabled}
            >
              <SelectTrigger
                className="h-8 text-sm"
                title={
                  hasOpenPositions
                    ? 'Cannot change account type while user has open positions'
                    : undefined
                }
              >
                <SelectValue
                  placeholder={
                    isUpdating ? 'Updating...' : 'Select type'
                  }
                >
                  {currentType === 'netting' ? 'Netting' : 'Hedging'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hedging">Hedging</SelectItem>
                <SelectItem value="netting">Netting</SelectItem>
              </SelectContent>
            </Select>
            {hasOpenPositions && (
              <p className="text-[10px] text-muted mt-0.5">Open positions</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'marginCalculationType',
      header: 'Total margin',
      cell: ({ row }) => {
        const user = row.original
        const currentType = user.marginCalculationType ?? 'hedged'
        const isUpdating = updatingMarginCalculationTypes.has(user.id)
        const hasOpenPositions = (user.openPositionsCount ?? 0) > 0
        const disabled = isUpdating || hasOpenPositions
        return (
          <div className="whitespace-nowrap min-w-[100px]">
            <Select
              value={currentType}
              onValueChange={(value) =>
                handleMarginCalculationTypeChange(user.id, user.name, value as 'hedged' | 'net')
              }
              disabled={disabled}
            >
              <SelectTrigger
                className="h-8 text-sm"
                title={
                  hasOpenPositions
                    ? 'Cannot change margin type while user has open positions'
                    : undefined
                }
              >
                <SelectValue
                  placeholder={
                    isUpdating ? 'Updating...' : 'Select'
                  }
                >
                  {currentType === 'net' ? 'Net (per symbol)' : 'Sum (all positions)'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hedged">Sum (all positions)</SelectItem>
                <SelectItem value="net">Net (per symbol)</SelectItem>
              </SelectContent>
            </Select>
            {hasOpenPositions && (
              <p className="text-[10px] text-muted mt-0.5">Open positions</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'tradingAccess',
      header: 'Trading access',
      cell: ({ row }) => {
        const user = row.original
        const currentAccess = user.tradingAccess ?? 'full'
        const isUpdating = updatingTradingAccess.has(user.id)
        return (
          <div className="whitespace-nowrap min-w-[140px]">
            <Select
              value={currentAccess}
              onValueChange={(value) =>
                handleTradingAccessChange(user.id, user.name, value as 'full' | 'close_only' | 'disabled')
              }
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder={isUpdating ? 'Updating...' : 'Select'}>
                  {currentAccess === 'full' ? 'Full access' : currentAccess === 'close_only' ? 'Close only' : 'Trading disabled'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full access</SelectItem>
                <SelectItem value="close_only">Close only</SelectItem>
                <SelectItem value="disabled">Trading disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )
      },
    },
    {
      id: 'leverage',
      header: 'Leverage',
      cell: ({ row }) => {
        const u = row.original
        const min = u.leverageLimitMin ?? 1
        const max = u.leverageLimitMax ?? 500
        return <span className="text-sm text-text whitespace-nowrap">{min} – {max}</span>
      },
    },
    {
      accessorKey: 'country',
      header: 'Country',
      cell: ({ row }) => {
        return <span className="font-mono text-sm whitespace-nowrap">{row.getValue('country')}</span>
      },
    },
    {
      accessorKey: 'balance',
      header: 'Balance',
      cell: ({ row }) => {
        return (
          <span className="font-mono font-semibold text-text whitespace-nowrap">
            {formatCurrency(row.getValue('balance'), 'USD')}
          </span>
        )
      },
    },
    {
      accessorKey: 'marginLevel',
      header: 'Margin Level %',
      cell: ({ row }) => {
        const level = row.getValue('marginLevel') as number
        return (
          <span className="font-mono text-sm text-text whitespace-nowrap">
            {level > 0 ? level.toFixed(2) + '%' : '—'}
          </span>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <div className="whitespace-nowrap">{getStatusBadge(row.getValue('status'))}</div>,
    },
    {
      accessorKey: 'kycStatus',
      header: 'KYC',
      cell: ({ row }) => <div className="whitespace-nowrap">{getKYCBadge(row.getValue('kycStatus'))}</div>,
    },
    {
      accessorKey: 'riskFlag',
      header: 'Risk Flag',
      cell: ({ row }) => <div className="whitespace-nowrap">{getRiskBadge(row.getValue('riskFlag'))}</div>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted whitespace-nowrap">{formatDateTime(row.getValue('createdAt'))}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const user = row.original
        return (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleView(user)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
            {canEditUser && (
              <Button variant="ghost" size="sm" onClick={() => handleEdit(user)} title="Edit">
                <Edit className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRestrict(user)}
              title="Restrict"
            >
              <Shield className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDisable(user)}
              title={user.status === 'active' ? 'Disable' : 'Enable'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return <DataTable data={users} columns={columns} />
}

