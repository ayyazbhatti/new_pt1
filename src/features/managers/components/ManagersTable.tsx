import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/Checkbox'
import { cn } from '@/shared/utils'
import type { Manager } from '../types/manager'
import type { UpdateManagerPayload } from '../api/managers.api'
import { setManagerTags } from '../api/managers.api'
import { formatDateTime } from '../utils/formatters'
import { useModalStore } from '@/app/store'
import { EditManagerModal } from '../modals/EditManagerModal'
import { DeleteManagerModal } from '../modals/DeleteManagerModal'
import { Pencil, UserX, UserCheck, Trash2, Tag, ChevronDown } from 'lucide-react'
import { useCanAccess } from '@/shared/utils/permissions'
import { toast } from '@/shared/components/common'
import { RoleBadge } from '@/features/auth/components/RoleBadge'
import { Spinner } from '@/shared/ui/loading'

interface ManagersTableProps {
  managers: Manager[]
  /** All tags for the assign-tags dropdown */
  allTags?: { id: string; name: string }[]
  onManagerUpdate?: (managerId: string, updates: UpdateManagerPayload) => void | Promise<void>
  onManagerRemoved?: (managerId: string) => void
  onRefresh?: () => void
}

export function ManagersTable({
  managers,
  allTags = [],
  onManagerUpdate,
  onManagerRemoved,
  onRefresh,
}: ManagersTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const canEditManagers = useCanAccess('managers:edit')
  const canDeleteManagers = useCanAccess('managers:delete')
  const [openTagsManagerId, setOpenTagsManagerId] = useState<string | null>(null)
  const [openTagsAnchorRect, setOpenTagsAnchorRect] = useState<DOMRect | null>(null)
  const [updatingTagsManagerId, setUpdatingTagsManagerId] = useState<string | null>(null)
  const tagsDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openTagsManagerId == null) return
    const handleClick = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node)) {
        setOpenTagsManagerId(null)
        setOpenTagsAnchorRect(null)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [openTagsManagerId])

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
    if (status === 'disabled') return <Badge variant="neutral">Disabled</Badge>
    return <Badge variant="neutral" className="capitalize">{status}</Badge>
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
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <RoleBadge role={row.original.role} />
        </div>
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
    ...(canEditManagers
      ? [
          {
            id: 'tags',
            header: 'Tags',
            cell: ({ row }: { row: { original: Manager } }) => {
              const manager = row.original
              const tagIds = manager.tagIds ?? []
              const isOpen = openTagsManagerId === manager.id
              const isUpdating = updatingTagsManagerId === manager.id
              const label =
                tagIds.length > 0
                  ? `${tagIds.length} tag${tagIds.length === 1 ? '' : 's'}`
                  : 'Assign tags'
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-text"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (openTagsManagerId === manager.id) {
                      setOpenTagsManagerId(null)
                      setOpenTagsAnchorRect(null)
                    } else {
                      setOpenTagsManagerId(manager.id)
                      setOpenTagsAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect())
                    }
                  }}
                  disabled={isUpdating}
                >
                  {isUpdating && <Spinner className="h-3.5 w-3.5 shrink-0" />}
                  <Tag className="h-4 w-4 shrink-0" />
                  <span className="max-w-[80px] truncate">{label}</span>
                  <ChevronDown
                    className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')}
                  />
                </Button>
              )
            },
          } as ColumnDef<Manager>,
        ]
      : []),
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
            {canEditManagers && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEdit(manager)}
                title="Edit manager"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canEditManagers && (
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
            )}
            {canDeleteManagers && (
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

  const openTagsManager = openTagsManagerId ? managers.find((m) => m.id === openTagsManagerId) : null
  const openTagsTagIds = openTagsManager?.tagIds ?? []

  const tagsDropdownPanel =
    openTagsManagerId && openTagsAnchorRect ? (
      createPortal(
        <div
          ref={tagsDropdownRef}
          className="fixed z-[100] min-w-[180px] rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
          style={{
            left: openTagsAnchorRect.left,
            top: openTagsAnchorRect.bottom + 4,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {allTags.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted">No tags defined</div>
          ) : (
            <div className="max-h-[220px] overflow-y-auto">
              {allTags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2"
                >
                  <Checkbox
                    checked={openTagsTagIds.includes(tag.id)}
                    onChange={(e) => {
                      const checked = e.target.checked
                      const next = checked
                        ? [...openTagsTagIds, tag.id]
                        : openTagsTagIds.filter((id) => id !== tag.id)
                      setUpdatingTagsManagerId(openTagsManagerId)
                      setManagerTags(openTagsManagerId, next)
                        .then(() => {
                          onRefresh?.()
                          toast.success('Tags updated')
                        })
                        .catch(() => toast.error('Failed to update tags'))
                        .finally(() => setUpdatingTagsManagerId(null))
                    }}
                  />
                  <span className="text-text">{tag.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>,
        document.body
      )
    ) : null

  return (
    <>
      <DataTable data={managers} columns={columns} />
      {tagsDropdownPanel}
    </>
  )
}
