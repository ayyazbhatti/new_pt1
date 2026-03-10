import { useState, useCallback, useMemo } from 'react'
import { Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ModalShell } from '@/shared/ui/modal'
import { Checkbox } from '@/shared/ui/Checkbox'
import { KeyRound, Plus, Pencil, Trash2, Shield, Check } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { useCanAccess } from '@/shared/utils/permissions'
import {
  listPermissionProfiles,
  listPermissionDefinitions,
  getPermissionProfile,
  createPermissionProfile,
  updatePermissionProfile,
  deletePermissionProfile,
  type PermissionProfile as ApiPermissionProfile,
  type PermissionCategoryDto,
} from '../api/permissionProfiles.api'

export type PermissionProfile = ApiPermissionProfile

const QUERY_KEY = ['permission-profiles'] as const
const DEFINITIONS_QUERY_KEY = ['permission-definitions'] as const

export function PermissionsPage() {
  const queryClient = useQueryClient()
  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listPermissionProfiles,
  })
  const { data: permissionCategories = [], isLoading: definitionsLoading, error: definitionsError } = useQuery({
    queryKey: DEFINITIONS_QUERY_KEY,
    queryFn: listPermissionDefinitions,
  })
  /** Categories with Users, Tags, Groups, Managers, Trading, Leverage Profiles, Symbols, Markup, Swap, Finance, Affiliate, Permissions, Support, Call, Appointments, Settings, then rest in the Create/Edit profile modal */
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
        c.name !== 'Affiliate' &&
        c.name !== 'Permissions' &&
        c.name !== 'Support' &&
        c.name !== 'Call' &&
        c.name !== 'Appointments' &&
        c.name !== 'Settings' &&
        c.name !== 'Configuration' &&
        c.name !== 'Risk & Reports'
    )
    return [...users, ...tags, ...groups, ...managers, ...trading, ...leverageProfiles, ...symbols, ...markup, ...swap, ...finance, ...affiliate, ...permissions, ...support, ...call, ...appointments, ...settings, ...rest]
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

  const openCreate = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormPermissionIds(new Set())
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((profile: PermissionProfile) => {
    setEditLoadingId(profile.id)
    getPermissionProfile(profile.id)
      .then((p) => {
        if (p) {
          setEditingId(p.id)
          setFormName(p.name)
          setFormDescription(p.description ?? '')
          setFormPermissionIds(new Set(p.permissionIds))
          setDialogOpen(true)
        } else {
          toast.error('Failed to load profile')
        }
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setEditLoadingId(null))
  }, [])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingId(null)
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
      if (selectAll) keys.forEach((k) => next.add(k))
      else keys.forEach((k) => next.delete(k))
      return next
    })
  }, [])

  const handleSave = useCallback(() => {
    const name = formName.trim()
    if (!name) return
    const permission_keys = Array.from(formPermissionIds)
    const description = formDescription.trim() || undefined

    if (editingId) {
      updateMutation.mutate(
        { id: editingId, payload: { name, description: description || null, permission_keys } },
        { onSuccess: closeDialog }
      )
    } else {
      createMutation.mutate(
        { name, description, permission_keys },
        { onSuccess: closeDialog }
      )
    }
  }, [editingId, formName, formDescription, formPermissionIds, closeDialog, updateMutation, createMutation])

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
        id: 'rights',
        header: 'Rights',
        cell: ({ row }) => (
          <span className="text-text-muted text-right block">{row.original.permissionIds.length}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="text-right block w-full">Actions</span>,
        cell: ({ row }) => {
          const profile = row.original
          if (!canEditPermissions) return null
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
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-400 hover:text-red-300 hover:border-red-500/50"
                onClick={() => handleDelete(profile)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          )
        },
      },
    ],
    [openEdit, handleDelete, canEditPermissions, editLoadingId]
  )

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
                          {profiles.map((profile) => (
                            <td
                              key={profile.id}
                              className="align-middle text-sm text-text whitespace-nowrap p-4 text-center"
                            >
                              {profile.permissionIds.includes(perm.key) ? (
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-accent">
                                  <Check className="h-3.5 w-3.5" />
                                </span>
                              ) : (
                                <span className="text-text-muted/50">—</span>
                              )}
                            </td>
                          ))}
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
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1.5">Description (optional)</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Short description of who this profile is for"
                className="w-full"
              />
            </div>
          </div>
          {/* Static: Access rights label + hint */}
          <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
            <label className="text-sm font-medium text-text">Access rights</label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => setFormPermissionIds(new Set(permissionCategories.flatMap((c) => c.permissions.map((p) => p.key))))}
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
          </div>
          <p className="text-xs text-text-muted mb-3 flex-shrink-0">Select the permissions included in this profile.</p>
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
                const selectedInCategory = categoryKeys.filter((k) => formPermissionIds.has(k)).length
                const allSelected = category.permissions.length > 0 && selectedInCategory === category.permissions.length
                const someSelected = selectedInCategory > 0
                const sectionIndeterminate = someSelected && !allSelected
                return (
                  <div key={category.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-text hover:opacity-90">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={sectionIndeterminate}
                          onChange={() => toggleCategory(category, !allSelected)}
                        />
                        <span>{category.name}</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 pl-6">
                      {category.permissions.map((perm) => (
                        <label
                          key={perm.id}
                          className="flex items-center gap-2 cursor-pointer text-sm text-text-muted hover:text-text"
                        >
                          <Checkbox
                            checked={formPermissionIds.has(perm.key)}
                            onChange={() => togglePermission(perm.key)}
                          />
                          <span>{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border flex-shrink-0">
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formName.trim() || createMutation.isPending || updateMutation.isPending || definitionsLoading || !!definitionsError}
            >
              {editingId ? (updateMutation.isPending ? 'Saving…' : 'Save changes') : createMutation.isPending ? 'Creating…' : 'Create profile'}
            </Button>
          </div>
        </div>
      </ModalShell>
    </ContentShell>
  )
}
