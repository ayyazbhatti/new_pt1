import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { listPermissionProfiles } from '@/features/permissions/api/permissionProfiles.api'
import { listTags } from '@/features/tags/api/tags.api'
import {
  listManagers,
  createManager,
  updateManager,
  deleteManager,
  type UpdateManagerPayload,
} from '../api/managers.api'
import { ManagerKPICards } from '../components/ManagerKPICards'
import { ManagerFiltersBar } from '../components/ManagerFiltersBar'
import { ManagersTable } from '../components/ManagersTable'
import { CreateManagerModal } from '../modals/CreateManagerModal'
import { Download, UserPlus } from 'lucide-react'
import { toast } from '@/shared/components/common'

function debounce<T extends (...args: any[]) => void>(func: T, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout)
  }
  return debounced
}

const MANAGERS_QUERY_KEY = ['managers'] as const

export function ManagersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const closeModal = useModalStore((state) => state.closeModal)
  const openModal = useModalStore((state) => state.openModal)
  const queryClient = useQueryClient()
  const canCreateManager = useCanAccess('managers:create')

  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const permissionProfile = searchParams.get('permission_profile') || 'all'

  const listParams = useMemo(
    () => ({
      ...(status !== 'all' && { status }),
      ...(permissionProfile !== 'all' && { permission_profile_id: permissionProfile }),
      ...(search?.trim() && { search: search.trim() }),
    }),
    [search, status, permissionProfile]
  )

  const { data: managers = [], isLoading, error, refetch } = useQuery({
    queryKey: [...MANAGERS_QUERY_KEY, listParams],
    queryFn: () => listManagers(listParams),
    placeholderData: keepPreviousData,
  })

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    setSearchInput(search)
  }, [search])
  const debouncedSetSearch = useMemo(
    () =>
      debounce((value: string) => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          if (value.trim()) next.set('search', value.trim())
          else next.delete('search')
          return next
        })
      }, 300),
    [setSearchParams]
  )
  useEffect(() => {
    debouncedSetSearch(searchInput)
    return () => debouncedSetSearch.cancel()
  }, [searchInput, debouncedSetSearch])

  const createMutation = useMutation({
    mutationFn: createManager,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MANAGERS_QUERY_KEY })
      closeModal('create-manager')
      toast.success('Manager created.')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to create manager')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateManagerPayload }) =>
      updateManager(id, payload),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: MANAGERS_QUERY_KEY })
      closeModal(`edit-manager-${id}`)
      toast.success('Manager updated.')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to update manager')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteManager,
    onSuccess: (_, managerId) => {
      queryClient.invalidateQueries({ queryKey: MANAGERS_QUERY_KEY })
      closeModal(`delete-manager-${managerId}`)
      toast.success('Manager removed.')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Failed to remove manager')
    },
  })

  const { data: permissionProfiles = [] } = useQuery({
    queryKey: ['permission-profiles'],
    queryFn: listPermissionProfiles,
  })

  const { data: tagsList = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => listTags(),
  })
  const allTags = tagsList.map((t) => ({ id: t.id, name: t.name }))

  const permissionProfileOptions = useMemo(() => {
    const fromManagers = managers.map((m) => ({
      id: m.permissionProfileId,
      name: m.permissionProfileName,
    }))
    const seen = new Set(fromManagers.map((p) => p.id))
    const fromApi = permissionProfiles.filter((p) => !seen.has(p.id)).map((p) => ({ id: p.id, name: p.name }))
    return [...fromManagers, ...fromApi]
  }, [managers, permissionProfiles])

  const handleCreateManager = () => {
    openModal(
      'create-manager',
      (
        <CreateManagerModal
          onCreated={(payload) => createMutation.mutate(payload)}
        />
      ),
      {
        title: 'Create Manager',
        description: 'Select a user and assign a permission profile to grant them manager access.',
        size: 'md',
      }
    )
  }

  const handleManagerUpdate = (managerId: string, updates: UpdateManagerPayload): Promise<void> => {
    return updateMutation.mutateAsync({ id: managerId, payload: updates }).then(() => {})
  }

  const handleManagerRemoved = (managerId: string) => {
    deleteMutation.mutate(managerId)
  }

  const handleExport = () => {
    toast.success('Export functionality coming soon.')
  }

  const handleFilterChange = (newFilters: { search: string; status: string; permissionProfile: string }) => {
    setSearchInput(newFilters.search)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (!newFilters.search.trim()) next.delete('search')
      if (newFilters.status !== 'all') next.set('status', newFilters.status)
      else next.delete('status')
      if (newFilters.permissionProfile !== 'all') next.set('permission_profile', newFilters.permissionProfile)
      else next.delete('permission_profile')
      return next
    })
  }

  if (isLoading && managers.length === 0) {
    return (
      <ContentShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading managers...</div>
        </div>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-danger mb-2">Failed to load managers</div>
            <div className="text-sm text-text-muted mb-4">
              {(error as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response?.data?.error?.message ??
                (error as Error)?.message ??
                'Unknown error'}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Managers"
        description="Manage staff with admin access. Promote users to managers, assign permission profiles, and enable or disable access."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            {canCreateManager && (
              <Button onClick={handleCreateManager}>
                <UserPlus className="h-4 w-4 mr-2" />
                Create Manager
              </Button>
            )}
          </div>
        }
      />
      <ManagerKPICards managers={managers} />
      <ManagerFiltersBar
        filters={{ search: searchInput, status, permissionProfile }}
        onFilterChange={handleFilterChange}
        permissionProfileOptions={permissionProfileOptions}
      />
      <ManagersTable
        managers={managers}
        allTags={allTags}
        onManagerUpdate={handleManagerUpdate}
        onManagerRemoved={handleManagerRemoved}
        onRefresh={() => refetch()}
      />
    </ContentShell>
  )
}
