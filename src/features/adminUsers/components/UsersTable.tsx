import { useState } from 'react'
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
import { updateUserGroup } from '../api/users.api'

interface UsersTableProps {
  users: User[]
  onUserUpdate?: (userId: string, updates: Partial<User>) => void
}

export function UsersTable({ users, onUserUpdate }: UsersTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const [updatingGroups, setUpdatingGroups] = useState<Set<string>>(new Set())

  // Fetch groups for the dropdown
  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page_size: 100, // Get a reasonable number of groups
  })

  const groups = groupsData?.items || []

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

  const handleView = (user: User) => {
    openModal(`user-details-${user.id}`, <UserDetailsModal user={user} />, {
      title: `User Details - ${user.name}`,
      size: 'xl',
    })
  }

  const handleEdit = (user: User) => {
    openModal(`edit-user-${user.id}`, <CreateEditUserModal user={user} />, {
      title: 'Edit User',
      size: 'md',
    })
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

        return (
          <div className="whitespace-nowrap min-w-[150px]">
            <Select
              value={currentGroupId}
              onValueChange={(value) => handleGroupChange(user.id, user.name, value)}
              disabled={groupsLoading || isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder={groupsLoading ? 'Loading...' : isUpdating ? 'Updating...' : currentGroupName || 'Select group'} />
              </SelectTrigger>
              <SelectContent>
                {groups.length === 0 && !groupsLoading && (
                  <SelectItem value="no-groups" disabled>No groups available</SelectItem>
                )}
                {groups.map((group) => (
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
            <Button variant="ghost" size="sm" onClick={() => handleEdit(user)} title="Edit">
              <Edit className="h-4 w-4" />
            </Button>
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

