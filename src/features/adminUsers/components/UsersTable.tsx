import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { User } from '../types/users'
import { useModalStore } from '@/app/store'
import { UserDetailsModal } from '../modals/UserDetailsModal'
import { CreateEditUserModal } from '../modals/CreateEditUserModal'
import { RestrictUserModal } from '../modals/RestrictUserModal'
import { Eye, Edit, Shield, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { formatDateTime, formatCurrency } from '../utils/formatters'

interface UsersTableProps {
  users: User[]
}

export function UsersTable({ users }: UsersTableProps) {
  const openModal = useModalStore((state) => state.openModal)

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
        return <span className="font-mono text-sm">{row.getValue('id')}</span>
      },
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        return <span className="font-semibold text-text">{row.getValue('name')}</span>
      },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{row.getValue('email')}</span>
      },
    },
    {
      accessorKey: 'groupName',
      header: 'Group',
    },
    {
      accessorKey: 'country',
      header: 'Country',
      cell: ({ row }) => {
        return <span className="font-mono text-sm">{row.getValue('country')}</span>
      },
    },
    {
      accessorKey: 'balance',
      header: 'Balance',
      cell: ({ row }) => {
        return (
          <span className="font-mono font-semibold text-text">
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
          <span className="font-mono text-sm text-text">
            {level > 0 ? level.toFixed(2) + '%' : '—'}
          </span>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => getStatusBadge(row.getValue('status')),
    },
    {
      accessorKey: 'kycStatus',
      header: 'KYC',
      cell: ({ row }) => getKYCBadge(row.getValue('kycStatus')),
    },
    {
      accessorKey: 'riskFlag',
      header: 'Risk Flag',
      cell: ({ row }) => getRiskBadge(row.getValue('riskFlag')),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('createdAt'))}</span>
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

