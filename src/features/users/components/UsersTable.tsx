import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { User } from '../types/user'
import { useModalStore } from '@/app/store'
import { UserDetailsModal } from '../modals/UserDetailsModal'
import { UserEditModal } from '../modals/UserEditModal'
import { Eye, Edit } from 'lucide-react'

interface UsersTableProps {
  users: User[]
}

export function UsersTable({ users }: UsersTableProps) {
  const openModal = useModalStore((state) => state.openModal)

  const handleView = (user: User) => {
    openModal(`user-details-${user.id}`, <UserDetailsModal user={user} />, {
      title: 'User Details',
      size: 'lg',
    })
  }

  const handleEdit = (user: User) => {
    openModal(`user-edit-${user.id}`, <UserEditModal user={user} />, {
      title: 'Edit User',
      size: 'md',
    })
  }

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'email',
      header: 'Email',
    },
    {
      accessorKey: 'role',
      header: 'Role',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variant = status === 'active' ? 'success' : status === 'suspended' ? 'danger' : 'neutral'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const user = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(user)}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(user)}
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return <DataTable data={users} columns={columns} />
}

