import { useState, useMemo } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listPermissionProfiles } from '@/features/permissions/api/permissionProfiles.api'
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

const MANAGERS_QUERY_KEY = ['managers'] as const

export function ManagersPage() {
  const closeModal = useModalStore((state) => state.closeModal)
  const openModal = useModalStore((state) => state.openModal)
  const queryClient = useQueryClient()
  const canEditUsers = useCanAccess('users:edit')

  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    permissionProfile: 'all',
  })

  const listParams = useMemo(() => ({
    ...(filters.status !== 'all' && { status: filters.status }),
    ...(filters.permissionProfile !== 'all' && { permission_profile_id: filters.permissionProfile }),
    ...(filters.search?.trim() && { search: filters.search.trim() }),
  }), [filters])

  const { data: managers = [], isLoading, error, refetch } = useQuery({
    queryKey: [...MANAGERS_QUERY_KEY, listParams],
    queryFn: () => listManagers(listParams),
  })

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

  if (isLoading) {
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
              {(error as Error)?.message ?? 'Unknown error'}
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
            {canEditUsers && (
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
        filters={filters}
        onFilterChange={setFilters}
        permissionProfileOptions={permissionProfileOptions}
      />
      <ManagersTable
        managers={managers}
        onManagerUpdate={handleManagerUpdate}
        onManagerRemoved={handleManagerRemoved}
      />
    </ContentShell>
  )
}
