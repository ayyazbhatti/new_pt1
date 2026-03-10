import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useCanAccess } from '@/shared/utils/permissions'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useLeverageProfilesList } from '../hooks/useLeverageProfiles'
import { LeverageProfileCard } from '../components/LeverageProfileCard'
import { ProfileFormDialog } from '../components/ProfileFormDialog'
import { DeleteProfileDialog } from '../components/DeleteProfileDialog'
import { ManageTiersModal } from '../modals/ManageTiersModal'
import { ArchiveConfirmModal } from '../modals/ArchiveConfirmModal'
import { Plus, Scale, CheckCircle, BarChart3, X } from 'lucide-react'
import { LeverageProfile } from '../types/leverageProfile'
import { listTags } from '@/features/tags/api/tags.api'
import { cn } from '@/shared/utils'

const STORAGE_SEARCH_KEY = 'leverage-tiers-management-search'

export function LeverageProfilesPage() {
  const canCreateProfile = useCanAccess('leverage_profiles:create')
  const [searchTerm, setSearchTerm] = useState(() => localStorage.getItem(STORAGE_SEARCH_KEY) ?? '')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<LeverageProfile | null>(null)
  const [deleteProfile, setDeleteProfile] = useState<LeverageProfile | null>(null)
  const [archiveProfile, setArchiveProfile] = useState<LeverageProfile | null>(null)
  const [manageTiersProfile, setManageTiersProfile] = useState<LeverageProfile | null>(null)

  useEffect(() => {
    if (searchTerm) localStorage.setItem(STORAGE_SEARCH_KEY, searchTerm)
    else localStorage.removeItem(STORAGE_SEARCH_KEY)
  }, [searchTerm])

  const listParams = useMemo(
    () => ({
      search: searchTerm.trim() || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter === 'archived' ? 'disabled' : 'active',
      page: 1,
      page_size: 500,
    }),
    [searchTerm, statusFilter]
  )

  const { data, isLoading, refetch } = useLeverageProfilesList(listParams)
  const { data: tagsList = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => listTags(),
  })
  const allTags = useMemo(() => tagsList.map((t) => ({ id: t.id, name: t.name })), [tagsList])
  const profiles = data?.items ?? []
  const totalProfiles = data?.total ?? 0
  const activeCount = useMemo(() => profiles.filter((p) => p.status === 'active').length, [profiles])
  const totalTiers = useMemo(
    () => profiles.reduce((acc, p) => acc + (p.tiersCount ?? 0), 0),
    [profiles]
  )

  const handleManageTiers = (profile: LeverageProfile) => {
    setManageTiersProfile(profile)
  }

  const handleEdit = (profile: LeverageProfile) => {
    setEditingProfile(profile)
  }

  const handleArchive = (profile: LeverageProfile) => {
    setArchiveProfile(profile)
  }

  const handleUnarchive = (profile: LeverageProfile) => {
    setArchiveProfile(profile)
  }

  const handleDelete = (profile: LeverageProfile) => {
    setDeleteProfile(profile)
  }

  return (
    <ContentShell>
      <PageHeader
        title="Leverage Profiles & Tiers"
        description="Configure leverage profiles with margin-based tiers and assign them to groups"
        actions={
          canCreateProfile ? (
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Profile
            </Button>
          ) : undefined
        }
      />

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-400/10 p-2 sm:p-3">
              <Scale className="h-5 w-5 sm:h-6 sm:w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-xs sm:text-sm text-text-muted">Total Profiles</p>
              <p className="text-xl sm:text-2xl font-bold text-text">{totalProfiles}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-400/10 p-2 sm:p-3">
              <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-green-400" />
            </div>
            <div>
              <p className="text-xs sm:text-sm text-text-muted">Active Profiles</p>
              <p className="text-xl sm:text-2xl font-bold text-text">{activeCount}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-400/10 p-2 sm:p-3">
              <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-orange-400" />
            </div>
            <div>
              <p className="text-xs sm:text-sm text-text-muted">Total Tiers</p>
              <p className="text-xl sm:text-2xl font-bold text-text">{totalTiers}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Leverage profiles block */}
      <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-text">Leverage Profiles</h2>
        <p className="text-sm text-text-muted mt-0.5">Manage leverage profiles and their associated tiers.</p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-text-muted">Search</label>
            <div className="relative">
              <Input
                placeholder="Search profiles by name or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-8"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="w-36">
            <label className="mb-1 block text-xs text-text-muted">Status</label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'archived')}>
              <SelectTrigger>
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-text-muted">Loading profiles...</div>
          ) : profiles.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface-2 p-12 text-center">
              <p className="text-text-muted font-medium">
                {searchTerm || statusFilter !== 'all' ? 'No profiles found.' : 'No profiles found.'}
              </p>
              <p className="text-sm text-text-dim mt-1">
                {searchTerm || statusFilter !== 'all'
                  ? 'Try adjusting your search or filter.'
                  : 'Create your first leverage profile to get started.'}
              </p>
              {!searchTerm && statusFilter === 'all' && canCreateProfile && (
                <Button
                  className="mt-4"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Profile
                </Button>
              )}
            </div>
          ) : (
            profiles.map((profile) => (
              <LeverageProfileCard
                key={profile.id}
                profile={profile}
                onManageTiers={handleManageTiers}
                onEdit={handleEdit}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
                onDelete={handleDelete}
                allTags={allTags}
                onRefresh={refetch}
              />
            ))
          )}
        </div>
      </div>

      {/* Create dialog */}
      <ProfileFormDialog
        mode="create"
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
          if (!open) refetch()
        }}
      />

      {/* Edit dialog */}
      <ProfileFormDialog
        mode="edit"
        initial={editingProfile ?? undefined}
        open={!!editingProfile}
        onOpenChange={(open) => {
          if (!open) setEditingProfile(null)
          refetch()
        }}
      />

      {/* Delete dialog */}
      {deleteProfile && (
        <DeleteProfileDialog
          profile={deleteProfile}
          open={!!deleteProfile}
          onOpenChange={(open) => {
            if (!open) setDeleteProfile(null)
            refetch()
          }}
        />
      )}

      {/* Archive confirm modal */}
      {archiveProfile && (
        <ArchiveConfirmModal
          profile={archiveProfile}
          open={!!archiveProfile}
          onOpenChange={(open) => {
            if (!open) setArchiveProfile(null)
            refetch()
          }}
        />
      )}

      {/* Manage Tiers modal */}
      {manageTiersProfile && (
        <ManageTiersModal
          profile={manageTiersProfile}
          open={!!manageTiersProfile}
          onOpenChange={(open) => {
            if (!open) setManageTiersProfile(null)
            refetch()
          }}
        />
      )}
    </ContentShell>
  )
}
