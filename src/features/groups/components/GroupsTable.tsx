import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { UserGroup, ProfileRef } from '../types/group'
import { GroupFormDialog } from './GroupFormDialog'
import { DeleteGroupDialog } from './DeleteGroupDialog'
import { AssignSymbolsModal } from '../modals/AssignSymbolsModal'
import { Eye, Edit, Trash2, Settings } from 'lucide-react'
import { useState } from 'react'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { formatDistanceToNow } from 'date-fns'
import { useUpdateGroupPriceProfile } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'

interface GroupsTableProps {
  groups: UserGroup[]
  availablePriceProfiles?: ProfileRef[]
  /** Callback to update group in parent state (same pattern as Admin Users page) so dropdown updates immediately */
  onGroupUpdate?: (groupId: string, updates: Partial<Pick<UserGroup, 'priceProfileId' | 'priceProfile'>>) => void
  onRefresh?: () => void
}

/** Sentinel for "None" – Radix Select forbids value="" on SelectItem */
const NONE_PROFILE_VALUE = '__none__'

export function GroupsTable({ groups, availablePriceProfiles = [], onGroupUpdate, onRefresh }: GroupsTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const canEditGroups = useCanAccess('groups:edit')
  const updatePriceProfile = useUpdateGroupPriceProfile()
  const [viewingGroup, setViewingGroup] = useState<UserGroup | null>(null)
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<UserGroup | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const handleSettings = (group: UserGroup) => {
    openModal(
      `group-symbol-settings-${group.id}`,
      <AssignSymbolsModal group={group} />,
      { title: `Symbol settings – ${group.name}`, size: 'xl' }
    )
  }

  const handleView = (group: UserGroup) => {
    setViewingGroup(group)
    setViewDialogOpen(true)
  }

  const handleEdit = (group: UserGroup) => {
    setEditingGroup(group)
    setEditDialogOpen(true)
  }

  const handleDelete = (group: UserGroup) => {
    setDeletingGroup(group)
    setDeleteDialogOpen(true)
  }

  const columns: ColumnDef<UserGroup>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        return <span className="font-semibold text-text">{row.getValue('name')}</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variant = status === 'active' ? 'success' : 'danger'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      accessorKey: 'marginCallLevel',
      header: 'Margin call %',
      cell: ({ row }) => {
        const v = row.original.marginCallLevel
        return <span className="text-text">{v != null ? `${v}%` : '—'}</span>
      },
    },
    {
      accessorKey: 'stopOutLevel',
      header: 'Stop out %',
      cell: ({ row }) => {
        const v = row.original.stopOutLevel
        return <span className="text-text">{v != null ? `${v}%` : '—'}</span>
      },
    },
    {
      id: 'priceProfile',
      header: 'Price profile',
      cell: ({ row }) => {
        const group = row.original
        const value = group.priceProfileId ?? group.priceProfile?.id ?? NONE_PROFILE_VALUE
        const isUpdating = updatePriceProfile.isPending && updatePriceProfile.variables?.groupId === group.id

        const handleChange = (newValue: string) => {
          const priceProfileId = newValue === NONE_PROFILE_VALUE ? null : newValue
          const profile =
            priceProfileId != null ? availablePriceProfiles.find((p) => p.id === priceProfileId) : null

          updatePriceProfile.mutate(
            { groupId: group.id, priceProfileId },
            {
              onSuccess: () => {
                onGroupUpdate?.(group.id, {
                  priceProfileId: priceProfileId ?? undefined,
                  priceProfile: profile ? { id: profile.id, name: profile.name } : null,
                })
                onRefresh?.()
              },
              onError: () => {
                onRefresh?.()
              },
            }
          )
        }

        return (
          <div onClick={(e) => e.stopPropagation()} className="w-[140px]">
            <Select value={value} onValueChange={handleChange} disabled={isUpdating}>
              <SelectTrigger className="h-8 text-sm w-full">
                {isUpdating && <Spinner className="h-3.5 w-3.5 mr-2 shrink-0" />}
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_PROFILE_VALUE}>None</SelectItem>
                {availablePriceProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      },
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ row }) => {
        const date = row.getValue('updatedAt') as string
        return (
          <span className="text-text-muted text-sm">
            {formatDistanceToNow(new Date(date), { addSuffix: true })}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const group = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSettings(group)}
              title="Symbol settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(group)}
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canEditGroups && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(group)}
                  title="Edit"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(group)}
                  title="Delete"
                  className="text-danger hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <>
      <DataTable data={groups} columns={columns} />
      
      {viewingGroup && (
        <GroupFormDialog
          mode="view"
          initial={viewingGroup}
          open={viewDialogOpen}
          onOpenChange={(open) => {
            setViewDialogOpen(open)
            if (!open) {
              setViewingGroup(null)
            }
          }}
        />
      )}

      {editingGroup && (
        <GroupFormDialog
          mode="edit"
          initial={editingGroup}
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open)
            if (!open) {
              setEditingGroup(null)
              onRefresh?.()
            }
          }}
        />
      )}

      {deletingGroup && (
        <DeleteGroupDialog
          group={deletingGroup}
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open)
            if (!open) {
              setDeletingGroup(null)
              onRefresh?.()
            }
          }}
        />
      )}
    </>
  )
}
