import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { UserGroup, ProfileRef } from '../types/group'
import { GroupFormDialog } from './GroupFormDialog'
import { DeleteGroupDialog } from './DeleteGroupDialog'
import { AssignSymbolsModal } from '../modals/AssignSymbolsModal'
import { Eye, Edit, Trash2, Settings, Copy, Tag, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { useCanAccess } from '@/shared/utils/permissions'
import { cn } from '@/shared/utils'
import { formatDistanceToNow } from 'date-fns'
import { useUpdateGroupPriceProfile } from '../hooks/useGroups'
import { Spinner } from '@/shared/ui/loading'
import { Checkbox } from '@/shared/ui/Checkbox'
import { setGroupTags } from '../api/groups.api'

interface GroupsTableProps {
  groups: UserGroup[]
  availablePriceProfiles?: ProfileRef[]
  /** Callback to update group in parent state (same pattern as Admin Users page) so dropdown updates immediately */
  onGroupUpdate?: (
    groupId: string,
    updates: Partial<Pick<UserGroup, 'priceProfileId' | 'priceProfile' | 'tagIds'>>
  ) => void
  onRefresh?: () => void
  /** All tags for the assign-tags dropdown */
  allTags?: { id: string; name: string }[]
}

/** Sentinel for "None" – Radix Select forbids value="" on SelectItem */
const NONE_PROFILE_VALUE = '__none__'

export function GroupsTable({
  groups,
  availablePriceProfiles = [],
  onGroupUpdate,
  onRefresh,
  allTags = [],
}: GroupsTableProps) {
  const openModal = useModalStore((state) => state.openModal)
  const canEditGroups = useCanAccess('groups:edit')
  const updatePriceProfile = useUpdateGroupPriceProfile()
  const [viewingGroup, setViewingGroup] = useState<UserGroup | null>(null)
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<UserGroup | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [openTagsGroupId, setOpenTagsGroupId] = useState<string | null>(null)
  const [openTagsAnchorRect, setOpenTagsAnchorRect] = useState<DOMRect | null>(null)
  const [updatingTagsGroupId, setUpdatingTagsGroupId] = useState<string | null>(null)
  const tagsDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openTagsGroupId == null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node)) {
        setOpenTagsGroupId(null)
        setOpenTagsAnchorRect(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openTagsGroupId])

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
      id: 'signupLink',
      header: 'Signup link',
      cell: ({ row }) => {
        const group = row.original
        const slug = group.signupSlug?.trim()
        const signupUrl =
          typeof window !== 'undefined' && slug
            ? `${window.location.origin}/register?ref=${encodeURIComponent(slug)}`
            : ''
        const handleCopy = () => {
          if (!signupUrl) return
          navigator.clipboard.writeText(signupUrl).then(
            () => toast.success('Signup link copied'),
            () => toast.error('Failed to copy')
          )
        }
        return (
          <div className="flex items-center gap-1.5">
            {slug ? (
              <>
                <span className="text-sm text-text-muted truncate max-w-[100px]" title={signupUrl}>
                  ?ref={slug}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  title="Copy signup link"
                  className="h-8 px-2"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </>
            ) : (
              <span className="text-sm text-text-muted">—</span>
            )}
          </div>
        )
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
      id: 'tags',
      header: 'Tags',
      cell: ({ row }) => {
        const group = row.original
        const tagIds = group.tagIds ?? []
        const isOpen = openTagsGroupId === group.id
        const isUpdating = updatingTagsGroupId === group.id

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
              if (openTagsGroupId === group.id) {
                setOpenTagsGroupId(null)
                setOpenTagsAnchorRect(null)
              } else {
                setOpenTagsGroupId(group.id)
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

  const openTagsGroup = openTagsGroupId ? groups.find((g) => g.id === openTagsGroupId) : null
  const openTagsTagIds = openTagsGroup?.tagIds ?? []

  const tagsDropdownPanel =
    openTagsGroupId && openTagsAnchorRect ? (
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
                      setUpdatingTagsGroupId(openTagsGroupId)
                      setGroupTags(openTagsGroupId, next)
                        .then(() => {
                          onGroupUpdate?.(openTagsGroupId, { tagIds: next })
                          onRefresh?.()
                          toast.success('Tags updated')
                        })
                        .catch(() => toast.error('Failed to update tags'))
                        .finally(() => setUpdatingTagsGroupId(null))
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
      <DataTable data={groups} columns={columns} />
      {tagsDropdownPanel}
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
