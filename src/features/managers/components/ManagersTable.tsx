import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { Manager } from '../types/manager'
import type { UpdateManagerPayload } from '../api/managers.api'
import { formatDateTime } from '../utils/formatters'
import { useModalStore } from '@/app/store'
import { EditManagerModal } from '../modals/EditManagerModal'
import { DeleteManagerModal } from '../modals/DeleteManagerModal'
import { Pencil, UserX, UserCheck, Trash2 } from 'lucide-react'
import { useCanAccess } from '@/shared/utils/permissions'
import { toast } from 'react-hot-toast'

interface ManagersTableProps {
  managers: Manager[]
  onManagerUpdate?: (managerId: string, updates: UpdateManagerPayload) => void | Promise<void>
  onManagerRemoved?: (managerId: string) => void
}

export function ManagersTable({
  managers,
  onManagerUpdate,
  onManagerRemoved,
}: ManagersTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const canEditUsers = useCanAccess('users:edit')

  const handleEdit = (manager: Manager) => {
    openModal(
      `edit-manager-${manager.id}`,
      (
        <EditManagerModal
          manager={manager}
          onSave={(updates) => onManagerUpdate?.(manager.id, updates)}
        />
      ),
      { title: 'Edit Manager', size: 'md' }
    )
  }

  const handleToggleStatus = async (manager: Manager) => {
    const newStatus = manager.status === 'active' ? 'disabled' : 'active'
    try {
      await onManagerUpdate?.(manager.id, { status: newStatus })
      toast.success(
        manager.status === 'active'
          ? `${manager.userName} has been disabled as a manager.`
          : `${manager.userName} has been re-enabled as a manager.`
      )
    } catch {
      // Error toast handled by parent mutation
    }
  }

  const handleDeleteClick = (manager: Manager) => {
    openModal(
      `delete-manager-${manager.id}`,
      (
        <DeleteManagerModal
          manager={manager}
          onConfirm={() => onManagerRemoved?.(manager.id)}
        />
      ),
      { title: 'Remove Manager', size: 'sm' }
    )
  }

  const getStatusBadge = (status: string) => {
    if (status === 'active') return <Badge variant="success">Active</Badge>
    return <Badge variant="neutral">Disabled</Badge>
  }

  const columns: ColumnDef<Manager>[] = [
    {
      accessorKey: 'userName',
      header: 'Name',
      cell: ({ row }) => (
        <span className="font-medium text-text whitespace-nowrap">{row.original.userName}</span>
      ),
    },
    {
      accessorKey: 'userEmail',
      header: 'Email',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">{row.original.userEmail}</span>
      ),
    },
    {
      accessorKey: 'permissionProfileName',
      header: 'Permission profile',
      cell: ({ row }) => (
        <span className="text-sm text-text whitespace-nowrap">
          {row.original.permissionProfileName}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">{getStatusBadge(row.original.status)}</div>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: 'lastLoginAt',
      header: 'Last login',
      cell: ({ row }) => (
        <span className="text-sm text-text-muted whitespace-nowrap">
          {formatDateTime(row.original.lastLoginAt)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const manager = row.original
        return (
          <div className="flex items-center gap-1">
            {canEditUsers && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEdit(manager)}
                title="Edit manager"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleToggleStatus(manager)}
              title={manager.status === 'active' ? 'Disable manager' : 'Enable manager'}
            >
              {manager.status === 'active' ? (
                <UserX className="h-4 w-4" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}
            </Button>
            {canEditUsers && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteClick(manager)}
                title="Remove manager"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return <DataTable data={managers} columns={columns} />
}
