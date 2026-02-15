import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { UserGroup } from '../types/group'
import { GroupFormDialog } from './GroupFormDialog'
import { DeleteGroupDialog } from './DeleteGroupDialog'
import { Eye, Edit, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'react-hot-toast'
import { updateGroupPriceProfile, updateGroupLeverageProfile } from '../api/groups.api'
import { useMarkupProfiles } from '@/features/adminMarkup/hooks/useMarkup'
import { useLeverageProfilesList } from '@/features/leverageProfiles/hooks/useLeverageProfiles'

interface GroupsTableProps {
  groups: UserGroup[]
  onRefresh?: () => void
}

export function GroupsTable({ groups, onRefresh }: GroupsTableProps) {
  const [viewingGroup, setViewingGroup] = useState<UserGroup | null>(null)
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<UserGroup | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [updatingProfiles, setUpdatingProfiles] = useState<Set<string>>(new Set())

  // Fetch available profiles (price stream = markup profiles from /api/admin/markup/profiles)
  const { data: priceProfilesData, isLoading: priceProfilesLoading, isError: priceProfilesError, refetch: refetchPriceProfiles } = useMarkupProfiles()
  const { data: leverageProfilesData } = useLeverageProfilesList({ page_size: 100 })
  
  // Handle both array response and paginated { items: [...] } shape
  const priceProfiles = (() => {
    if (Array.isArray(priceProfilesData)) return priceProfilesData
    const d = priceProfilesData as { items?: unknown[]; data?: unknown[] } | undefined
    if (d?.items && Array.isArray(d.items)) return d.items
    if (d?.data && Array.isArray(d.data)) return d.data
    return []
  })() as { id: string; name: string }[]
  const leverageProfiles = leverageProfilesData?.items || []

  const handlePriceProfileChange = async (groupId: string, groupName: string, profileId: string | null) => {
    const key = `${groupId}-price`
    setUpdatingProfiles((prev) => new Set(prev).add(key))
    
    try {
      await updateGroupPriceProfile(groupId, profileId)
      const profileName = profileId ? priceProfiles.find(p => p.id === profileId)?.name || 'Unknown' : 'None'
      toast.success(`Price stream profile for ${groupName} updated to ${profileName}`)
      onRefresh?.()
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to update price profile'
      toast.error(errorMessage)
    } finally {
      setUpdatingProfiles((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const handleLeverageProfileChange = async (groupId: string, groupName: string, profileId: string | null) => {
    const key = `${groupId}-leverage`
    setUpdatingProfiles((prev) => new Set(prev).add(key))
    
    try {
      await updateGroupLeverageProfile(groupId, profileId)
      const profileName = profileId ? leverageProfiles.find(p => p.id === profileId)?.name || 'Unknown' : 'None'
      toast.success(`Leverage profile for ${groupName} updated to ${profileName}`)
      onRefresh?.()
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to update leverage profile'
      toast.error(errorMessage)
    } finally {
      setUpdatingProfiles((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
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
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ row }) => {
        return <span className="text-text">{row.getValue('priority')}</span>
      },
    },
    {
      id: 'leverage',
      header: 'Leverage',
      cell: ({ row }) => {
        const group = row.original
        return (
          <span className="text-text font-mono text-sm">
            {group.minLeverage}× — {group.maxLeverage}×
          </span>
        )
      },
    },
    {
      id: 'limits',
      header: 'Limits',
      cell: ({ row }) => {
        const group = row.original
        return (
          <span className="text-text text-sm">
            Pos: {group.maxOpenPositions} • Ord: {group.maxOpenOrders}
          </span>
        )
      },
    },
    {
      accessorKey: 'riskMode',
      header: 'Risk Mode',
      cell: ({ row }) => {
        const riskMode = row.getValue('riskMode') as string
        const variant = riskMode === 'aggressive' ? 'warning' : riskMode === 'conservative' ? 'info' : 'neutral'
        return <Badge variant={variant}>{riskMode}</Badge>
      },
    },
    {
      id: 'priceProfile',
      header: 'Price Stream Profile',
      cell: ({ row }) => {
        const group = row.original
        const currentProfileId = group.priceProfileId || ''
        const isUpdating = updatingProfiles.has(`${group.id}-price`)
        const currentProfileName = priceProfiles.find(p => p.id === currentProfileId)?.name || 'None'
        const selectPlaceholder = isUpdating
          ? 'Updating...'
          : priceProfilesLoading
            ? 'Loading...'
            : priceProfilesError
              ? 'Failed to load'
              : currentProfileName

        return (
          <div className="min-w-[180px]">
            <Select
              value={currentProfileId || 'none'}
              onValueChange={(value) => handlePriceProfileChange(group.id, group.name, value === 'none' ? null : value)}
              onOpenChange={(open) => open && refetchPriceProfiles()}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                {priceProfilesError ? (
                  <span className="text-destructive">Failed to load</span>
                ) : (
                  <SelectValue placeholder={selectPlaceholder} />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {priceProfiles.length === 0 && !priceProfilesLoading && !priceProfilesError && (
                  <SelectItem value="__empty" disabled>No profiles — add in Admin → Markup</SelectItem>
                )}
                {priceProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      },
    },
    {
      id: 'leverageProfile',
      header: 'Leverage Profile',
      cell: ({ row }) => {
        const group = row.original
        const currentProfileId = group.leverageProfileId || ''
        const isUpdating = updatingProfiles.has(`${group.id}-leverage`)
        const currentProfileName = leverageProfiles.find(p => p.id === currentProfileId)?.name || 'None'

        return (
          <div className="min-w-[180px]">
            <Select
              value={currentProfileId || 'none'}
              onValueChange={(value) => handleLeverageProfileChange(group.id, group.name, value === 'none' ? null : value)}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder={isUpdating ? 'Updating...' : currentProfileName} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {leverageProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
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
              onClick={() => handleView(group)}
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>
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
