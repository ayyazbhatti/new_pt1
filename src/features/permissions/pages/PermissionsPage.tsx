import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ModalShell } from '@/shared/ui/modal'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Spinner } from '@/shared/ui/loading'
import { KeyRound, Plus, Pencil, Trash2, Shield, Check, Tag, ChevronDown, ShieldCheck, List, Tag as TagIcon } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { useAuthStore } from '@/shared/store/auth.store'
import { useCanAccess } from '@/shared/utils/permissions'
import { cn } from '@/shared/utils'
import { listTags } from '@/features/tags/api/tags.api'
import {
  listPermissionProfiles,
  listPermissionDefinitions,
  getPermissionProfile,
  createPermissionProfile,
  updatePermissionProfile,
  deletePermissionProfile,
  setPermissionProfileTags,
  type PermissionProfile as ApiPermissionProfile,
  type PermissionCategoryDto,
} from '../api/permissionProfiles.api'

export type PermissionProfile = ApiPermissionProfile

const QUERY_KEY = ['permission-profiles'] as const
const DEFINITIONS_QUERY_KEY = ['permission-definitions'] as const
const TAGS_QUERY_KEY = ['admin', 'tags'] as const

export function PermissionsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const refreshUser = useAuthStore((s) => s.refreshUser)
  /** Permissions the current user has; checkboxes for other permissions are disabled so they cannot grant more than they have. */
  const userPermissionSet = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions])
  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listPermissionProfiles,
  })
  const { data: permissionCategories = [], isLoading: definitionsLoading, error: definitionsError } = useQuery({
    queryKey: DEFINITIONS_QUERY_KEY,
    queryFn: listPermissionDefinitions,
  })
  const { data: tagsList = [] } = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: () => listTags(),
  })
  const allTags = useMemo(() => tagsList.map((t) => ({ id: t.id, name: t.name })), [tagsList])
  /** Categories with Users, Tags, Groups, Managers, Trading, Leverage Profiles, Symbols, Markup, Swap, Finance, Leads, Affiliate, Permissions, Support, Call, Appointments, Settings, then rest in the Create/Edit profile modal */
  const permissionCategoriesSorted = useMemo(() => {
    const users = permissionCategories.filter((c) => c.name === 'Users')
    const tags = permissionCategories.filter((c) => c.name === 'Tags')
    const groups = permissionCategories.filter((c) => c.name === 'Groups')
    const managers = permissionCategories.filter((c) => c.name === 'Managers')
    const trading = permissionCategories.filter((c) => c.name === 'Trading')
    const leverageProfiles = permissionCategories.filter((c) => c.name === 'Leverage Profiles')
    const symbols = permissionCategories.filter((c) => c.name === 'Symbols')
    const markup = permissionCategories.filter((c) => c.name === 'Markup')
    const swap = permissionCategories.filter((c) => c.name === 'Swap')
    const finance = permissionCategories.filter((c) => c.name === 'Finance')
    const leads = permissionCategories.filter((c) => c.name === 'Leads')
    const affiliate = permissionCategories.filter((c) => c.name === 'Affiliate')
    const permissions = permissionCategories.filter((c) => c.name === 'Permissions')
    const support = permissionCategories.filter((c) => c.name === 'Support')
    const call = permissionCategories.filter((c) => c.name === 'Call')
    const appointments = permissionCategories.filter((c) => c.name === 'Appointments')
    const settings = permissionCategories.filter((c) => c.name === 'Settings')
    const rest = permissionCategories.filter(
      (c) =>
        c.name !== 'Users' &&
        c.name !== 'Groups' &&
        c.name !== 'Tags' &&
        c.name !== 'Managers' &&
        c.name !== 'Trading' &&
        c.name !== 'Leverage Profiles' &&
        c.name !== 'Symbols' &&
        c.name !== 'Markup' &&
        c.name !== 'Swap' &&
        c.name !== 'Finance' &&
        c.name !== 'Leads' &&
        c.name !== 'Affiliate' &&
        c.name !== 'Permissions' &&
        c.name !== 'Support' &&
        c.name !== 'Call' &&
        c.name !== 'Appointments' &&
        c.name !== 'Settings' &&
        c.name !== 'Configuration' &&
        c.name !== 'Risk & Reports'
    )
    return [...users, ...tags, ...groups, ...managers, ...trading, ...leverageProfiles, ...symbols, ...markup, ...swap, ...finance, ...leads, ...affiliate, ...permissions, ...support, ...call, ...appointments, ...settings, ...rest]
  }, [permissionCategories])
  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string; permission_keys: string[] }) =>
      createPermissionProfile(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success('Profile created')
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create profile'),
  })
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: { name?: string; description?: string | null; permission_keys?: string[] }
    }) => updatePermissionProfile(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success('Profile updated')
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to update profile'),
  })
  const deleteMutation = useMutation({
    mutationFn: deletePermissionProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success('Profile deleted')
      refreshUser().catch((e) => console.error('Failed to refresh user after profile delete', e))
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to delete profile'),
  })

  const canEditPermissions = useCanAccess('permissions:edit')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPermissionIds, setFormPermissionIds] = useState<Set<string>>(new Set())
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null)
  const [editingProfileName, setEditingProfileName] = useState<string | null>(null)
  const [openTagsProfileId, setOpenTagsProfileId] = useState<string | null>(null)
  const [openTagsAnchorRect, setOpenTagsAnchorRect] = useState<DOMRect | null>(null)
  const [updatingTagsProfileId, setUpdatingTagsProfileId] = useState<string | null>(null)
  const tagsDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openTagsProfileId == null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node)) {
        setOpenTagsProfileId(null)
        setOpenTagsAnchorRect(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openTagsProfileId])

  // When editing Full Access, keep formPermissionIds in sync with all definitions (e.g. after definitions load)
  const allPermissionKeysFromDefinitions = useMemo(
    () => permissionCategories.flatMap((c) => c.permissions.map((p) => p.key)),
    [permissionCategories]
  )
  useEffect(() => {
    if (!dialogOpen || editingProfileName?.toLowerCase() !== 'full access' || allPermissionKeysFromDefinitions.length === 0) return
    setFormPermissionIds((prev) => {
      const target = new Set(allPermissionKeysFromDefinitions)
      if (prev.size === target.size && allPermissionKeysFromDefinitions.every((k) => prev.has(k))) return prev
      return target
    })
  }, [dialogOpen, editingProfileName, allPermissionKeysFromDefinitions])

  const openCreate = useCallback(() => {
    setEditingId(null)
    setEditingProfileName(null)
    setFormName('')
    setFormDescription('')
    setFormPermissionIds(new Set())
    setDialogOpen(true)
  }, [])

  const isFullAccessProfile = editingProfileName?.toLowerCase() === 'full access'

  const openEdit = useCallback(
    (profile: PermissionProfile) => {
      setEditLoadingId(profile.id)
      setEditingProfileName(profile.name)
      getPermissionProfile(profile.id)
        .then((p) => {
          if (p) {
            setEditingId(p.id)
            setFormName(p.name)
            setFormDescription(p.description ?? '')
            if (p.name?.toLowerCase() === 'full access') {
              setFormPermissionIds(
                new Set(permissionCategories.flatMap((c) => c.permissions.map((perm) => perm.key)))
              )
            } else {
              setFormPermissionIds(new Set(p.permissionIds))
            }
            setDialogOpen(true)
          } else {
            toast.error('Failed to load profile')
          }
        })
        .catch(() => toast.error('Failed to load profile'))
        .finally(() => setEditLoadingId(null))
    },
    [permissionCategories]
  )

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingId(null)
    setEditingProfileName(null)
  }, [])

  const togglePermission = useCallback((id: string) => {
    setFormPermissionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleCategory = useCallback((category: PermissionCategoryDto, selectAll: boolean) => {
    const keys = category.permissions.map((p) => p.key)
    setFormPermissionIds((prev) => {
      const next = new Set(prev)
      if (selectAll) keys.filter((k) => userPermissionSet.has(k)).forEach((k) => next.add(k))
      else keys.filter((k) => userPermissionSet.has(k)).forEach((k) => next.delete(k))
      return next
    })
  }, [userPermissionSet])

  const handleSave = useCallback(() => {
    const name = formName.trim()
    if (!name) return
    const permission_keys = Array.from(formPermissionIds)
    const description = formDescription.trim() || undefined

    const onUpdateSuccess = (updated: PermissionProfile) => {
      // Update cache immediately so the table reflects the edit without waiting for refetch
      queryClient.setQueryData<PermissionProfile[]>(QUERY_KEY, (prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev
      )
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      refreshUser().catch((e) => console.error('Failed to refresh user after profile update', e))
      closeDialog()
    }

    const onCreateSuccess = (created: PermissionProfile) => {
      queryClient.setQueryData<PermissionProfile[]>(QUERY_KEY, (prev) =>
        prev ? [...prev, created] : [created]
      )
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      refreshUser().catch((e) => console.error('Failed to refresh user after profile update', e))
      closeDialog()
    }

    if (editingId) {
      updateMutation.mutate(
        { id: editingId, payload: { name, description: description || null, permission_keys } },
        { onSuccess: onUpdateSuccess }
      )
    } else {
      createMutation.mutate(
        { name, description, permission_keys },
        { onSuccess: onCreateSuccess }
      )
    }
  }, [editingId, formName, formDescription, formPermissionIds, closeDialog, updateMutation, createMutation, queryClient, refreshUser])

  const handleDelete = useCallback(
    (profile: PermissionProfile) => {
      if (!window.confirm(`Delete profile "${profile.name}"? Managers using this profile will need another assignment.`)) return
      deleteMutation.mutate(profile.id)
    },
    [deleteMutation]
  )

  const profileColumns: ColumnDef<PermissionProfile>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-semibold text-text">{row.original.name}</span>,
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) => (
          <span className="text-text-muted">{row.original.description ?? '—'}</span>
        ),
      },
      {
        id: 'createdBy',
        header: 'Created by',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.createdByEmail ?? '—'}
          </span>
        ),
      },
      {
        id: 'rights',
        header: 'Rights',
        cell: ({ row }) => (
          <span className="text-text-muted text-right block">{row.original.permissionIds.length}</span>
        ),
      },
      ...(canEditPermissions
        ? [
            {
              id: 'tags',
              header: 'Tags',
              cell: ({ row }: { row: { original: PermissionProfile } }) => {
                const profile = row.original
                const tagIds = profile.tagIds ?? []
                const isOpen = openTagsProfileId === profile.id
                const isUpdating = updatingTagsProfileId === profile.id
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
                      if (openTagsProfileId === profile.id) {
                        setOpenTagsProfileId(null)
                        setOpenTagsAnchorRect(null)
                      } else {
                        setOpenTagsProfileId(profile.id)
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
            } as ColumnDef<PermissionProfile>,
          ]
        : []),
      {
        id: 'actions',
        header: () => <span className="text-right block w-full">Actions</span>,
        cell: ({ row }) => {
          const profile = row.original
          if (!canEditPermissions) return null
          const isFullAccess = profile.name?.toLowerCase() === 'full access'
          return (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => openEdit(profile)}
                disabled={editLoadingId === profile.id}
              >
                <Pencil className="h-3.5 w-3.5" />
                {editLoadingId === profile.id ? 'Loading…' : 'Edit'}
              </Button>
              {!isFullAccess && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-400 hover:text-red-300 hover:border-red-500/50"
                onClick={() => handleDelete(profile)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              )}
            </div>
          )
        },
      },
    ],
    [openEdit, handleDelete, canEditPermissions, editLoadingId, openTagsProfileId, updatingTagsProfileId]
  )

  const openTagsProfile = openTagsProfileId ? profiles.find((p) => p.id === openTagsProfileId) : null
  const openTagsTagIds = openTagsProfile?.tagIds ?? []

  const tagsDropdownPanel =
    openTagsProfileId && openTagsAnchorRect
      ? createPortal(
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
                        setUpdatingTagsProfileId(openTagsProfileId)
                        setPermissionProfileTags(openTagsProfileId, next)
                          .then(() => {
                            queryClient.invalidateQueries({ queryKey: QUERY_KEY })
                            toast.success('Tags updated')
                          })
                          .catch(() => toast.error('Failed to update tags'))
                          .finally(() => setUpdatingTagsProfileId(null))
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
      : null

  return (
    <ContentShell>
      <PageHeader
        title="Permission profiles"
        description="Create and edit permission profiles. Assign a profile to a manager when creating or editing their account."
        actions={
          canEditPermissions ? (
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Create profile
            </Button>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-blue-500">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Total profiles</p>
            <p className="mt-1 text-lg font-bold text-text">{profiles.length}</p>
            <p className="mt-0.5 text-xs text-text-muted">Permission profiles</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-emerald-500">
            <List className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Permission categories</p>
            <p className="mt-1 text-lg font-bold text-text">{permissionCategories.length}</p>
            <p className="mt-0.5 text-xs text-text-muted">Definition categories</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-amber-500">
            <TagIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Profiles with tags</p>
            <p className="mt-1 text-lg font-bold text-text">
              {profiles.filter((p) => (p.tagIds?.length ?? 0) > 0).length}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Tag assignments</p>
          </div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-lg bg-surface-2 p-2 text-slate-400">
            <KeyRound className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-muted">Total permissions</p>
            <p className="mt-1 text-lg font-bold text-text">
              {permissionCategories.reduce((sum, c) => sum + (c.permissions?.length ?? 0), 0)}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Across all categories</p>
          </div>
        </Card>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error instanceof Error ? error.message : 'Failed to load profiles'}
        </div>
      )}
      {definitionsError && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load permission definitions. Create/Edit profile and the Permissions table may be incomplete.
        </div>
      )}
      {isLoading && (
        <p className="text-text-muted text-sm">Loading profiles…</p>
      )}
      {definitionsLoading && !definitionsError && (
        <p className="text-text-muted text-sm">Loading permission definitions…</p>
      )}

      <Tabs defaultValue="profiles" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="profiles" className="gap-2">
            <Shield className="h-4 w-4" />
            Profiles
          </TabsTrigger>
          <TabsTrigger value="permissions" className="gap-2">
            <KeyRound className="h-4 w-4" />
            Permissions by profile
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-0">
          <DataTable data={profiles} columns={profileColumns} className="space-y-0" />
        </TabsContent>

        <TabsContent value="permissions" className="mt-0">
          <div className="rounded-lg border border-border overflow-hidden">
            {definitionsLoading ? (
              <p className="p-4 text-sm text-text-muted">Loading permission definitions…</p>
            ) : definitionsError ? (
              <p className="p-4 text-sm text-danger">Failed to load permission definitions.</p>
            ) : permissionCategories.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">No permission definitions in the database. Run migrations to seed them.</p>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="bg-surface-2 border-b border-border">
                  <tr>
                    <th className="text-left align-middle font-medium text-text-muted text-sm whitespace-nowrap h-12 px-4">
                      Permission
                    </th>
                    {profiles.map((p) => (
                      <th
                        key={p.id}
                        className="text-center align-middle font-medium text-text-muted text-sm whitespace-nowrap h-12 px-4 w-28"
                      >
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {permissionCategories.map((category: PermissionCategoryDto) => (
                    <Fragment key={category.id}>
                      <tr className="bg-surface-2/50">
                        <td
                          colSpan={profiles.length + 1}
                          className="align-middle text-sm font-medium text-text px-4 py-2"
                        >
                          {category.name}
                        </td>
                      </tr>
                      {category.permissions.map((perm) => (
                        <tr key={perm.id} className="hover:bg-surface-2/50 transition-colors">
                          <td className="align-middle text-sm text-text whitespace-nowrap p-4">
                            {perm.label}
                          </td>
                          {profiles.map((profile) => {
                            const isFullAccess = profile.name?.toLowerCase() === 'full access'
                            const hasPermission = isFullAccess || profile.permissionIds.includes(perm.key)
                            return (
                              <td
                                key={profile.id}
                                className="align-middle text-sm text-text whitespace-nowrap p-4 text-center"
                              >
                                {hasPermission ? (
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-accent">
                                    <Check className="h-3.5 w-3.5" />
                                  </span>
                                ) : (
                                  <span className="text-text-muted/50">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <p className="mt-6 text-xs text-text-muted">
        Assign a permission profile to a manager in the Users page when creating or editing their account.
      </p>

      {tagsDropdownPanel}

      {/* Create / Edit profile modal */}
      <ModalShell
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onClose={closeDialog}
        title={editingId ? 'Edit permission profile' : 'Create permission profile'}
        description={editingId ? 'Update the profile name and access rights.' : 'Define a new profile with a name and access rights. You can then assign this profile to managers.'}
        size="lg"
      >
        <div className="flex flex-col min-h-0 flex-1">
          {/* Static: Name + Description */}
          <div className="grid grid-cols-2 gap-4 flex-shrink-0 mb-4">
            <div>
              <label className="block text-sm font-medium text-text mb-1.5">Name</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Trading manager"
                className="w-full"
                disabled={isFullAccessProfile}
                readOnly={isFullAccessProfile}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1.5">Description (optional)</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Short description of who this profile is for"
                className="w-full"
                disabled={isFullAccessProfile}
                readOnly={isFullAccessProfile}
              />
            </div>
          </div>
          {isFullAccessProfile && (
            <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 mb-4 flex-shrink-0">
              This profile is for super admin. All permissions are included and cannot be changed.
            </p>
          )}
          {/* Static: Access rights label + hint */}
          <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
            <label className="text-sm font-medium text-text">Access rights</label>
            {!isFullAccessProfile && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setFormPermissionIds(new Set(permissionCategories.flatMap((c) => c.permissions.map((p) => p.key)).filter((k) => userPermissionSet.has(k))))}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setFormPermissionIds(new Set())}
                >
                  Unselect all
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-text-muted mb-3 flex-shrink-0">
            {isFullAccessProfile
              ? 'All permissions are granted and locked for this profile.'
              : 'Select the permissions included in this profile. You can only assign permissions you have; others are disabled.'}
          </p>
          {/* Scrollable: permission list only (from DB); Users & Groups first */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-surface-2/30 p-4 pr-2">
            {definitionsLoading ? (
              <p className="text-sm text-text-muted">Loading access rights…</p>
            ) : definitionsError ? (
              <p className="text-sm text-danger">Failed to load access rights. Please try again later.</p>
            ) : (
            <div className="space-y-4">
              {permissionCategoriesSorted.map((category: PermissionCategoryDto) => {
                const categoryKeys = category.permissions.map((p) => p.key)
                const userKeysInCategory = categoryKeys.filter((k) => userPermissionSet.has(k))
                const selectedUserInCategory = userKeysInCategory.filter((k) => formPermissionIds.has(k)).length
                const allSelected = userKeysInCategory.length > 0 && selectedUserInCategory === userKeysInCategory.length
                const someSelected = selectedUserInCategory > 0
                const sectionIndeterminate = someSelected && !allSelected
                const categoryDisabled = userKeysInCategory.length === 0
                return (
                  <div key={category.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <label className={cn('flex items-center gap-2 text-sm font-medium text-text', !categoryDisabled && !isFullAccessProfile && 'cursor-pointer hover:opacity-90')}>
                        <Checkbox
                          checked={allSelected}
                          indeterminate={sectionIndeterminate}
                          onChange={() => toggleCategory(category, !allSelected)}
                          disabled={categoryDisabled || isFullAccessProfile}
                        />
                        <span>{category.name}</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 pl-6">
                      {category.permissions.map((perm) => {
                        const userHasPerm = userPermissionSet.has(perm.key)
                        const checkboxDisabled = isFullAccessProfile || !userHasPerm
                        return (
                          <label
                            key={perm.id}
                            className={cn(
                              'flex items-center gap-2 text-sm text-text-muted',
                              !checkboxDisabled ? 'cursor-pointer hover:text-text' : 'cursor-not-allowed opacity-60'
                            )}
                          >
                            <Checkbox
                              checked={formPermissionIds.has(perm.key)}
                              onChange={() => togglePermission(perm.key)}
                              disabled={checkboxDisabled}
                            />
                            <span>{perm.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border flex-shrink-0">
            <Button variant="outline" onClick={closeDialog}>
              {isFullAccessProfile ? 'Close' : 'Cancel'}
            </Button>
            {!isFullAccessProfile && (
              <Button
                onClick={handleSave}
                disabled={!formName.trim() || createMutation.isPending || updateMutation.isPending || definitionsLoading || !!definitionsError}
              >
                {editingId ? (updateMutation.isPending ? 'Saving…' : 'Save changes') : createMutation.isPending ? 'Creating…' : 'Create profile'}
              </Button>
            )}
          </div>
        </div>
      </ModalShell>
    </ContentShell>
  )
}
