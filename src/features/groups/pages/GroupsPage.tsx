import { ContentShell, PageHeader } from '@/shared/layout'
import { useCanAccess } from '@/shared/utils/permissions'
import { GroupsTable } from '../components/GroupsTable'
import { GroupFormDialog } from '../components/GroupFormDialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useGroupsList } from '../hooks/useGroups'
import { useMarkupProfiles } from '@/features/adminMarkup/hooks/useMarkup'
import { useQuery } from '@tanstack/react-query'
import { listTags } from '@/features/tags/api/tags.api'
import type { UserGroup } from '../types/group'
import { Plus, X } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Skeleton } from '@/shared/ui/loading'
import { EmptyState } from '@/shared/ui/empty'
// Simple debounce implementation
function debounce<T extends (...args: any[]) => void>(func: T, wait: number) {
  let timeout: NodeJS.Timeout | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout)
  }
  return debounced
}

export function GroupsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const canCreateGroups = useCanAccess('groups:create')

  // Get params from URL
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || 'all'
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('page_size') || '20', 10)
  const sort = searchParams.get('sort') || 'created_desc'

  // Fetch groups
  const { data, isLoading, error, refetch } = useGroupsList({
    search: search || undefined,
    status: status !== 'all' ? status : undefined,
    page,
    page_size: pageSize,
    sort,
  })

  // Price profile dropdown: use list from groups API, or fallback to markup profiles (same source as Markup page)
  const { data: markupProfiles } = useMarkupProfiles()
  const normalizeId = (id: string) => (id == null || id === '' ? '' : String(id).toLowerCase())
  const availablePriceProfiles =
    (data?.availablePriceProfiles?.length ? data.availablePriceProfiles : (markupProfiles ?? []).map((p) => ({ id: normalizeId(p.id), name: p.name }))) ?? []

  // Local state for groups list (same pattern as Admin Users page) so price profile dropdown updates immediately
  const [groupsState, setGroupsState] = useState<UserGroup[]>([])
  const groupsFromApi = data?.items ?? []
  useEffect(() => {
    if (groupsFromApi.length > 0) {
      setGroupsState(groupsFromApi)
    }
  }, [data?.items])

  const displayGroups = groupsState.length > 0 ? groupsState : groupsFromApi

  const handleGroupUpdate = (
    groupId: string,
    updates: Partial<Pick<UserGroup, 'priceProfileId' | 'priceProfile' | 'tagIds'>>
  ) => {
    setGroupsState((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, ...updates } : g))
    )
  }

  const { data: tagsList = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => listTags(),
  })
  const allTags = tagsList.map((t) => ({ id: t.id, name: t.name }))

  // Debounced search
  const [searchInput, setSearchInput] = useState(search)
  const debouncedSetSearch = useMemo(
    () =>
      debounce((value: string) => {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev)
          if (value) {
            newParams.set('search', value)
          } else {
            newParams.delete('search')
          }
          newParams.set('page', '1') // Reset to first page
          return newParams
        })
      }, 300),
    [setSearchParams]
  )

  useEffect(() => {
    debouncedSetSearch(searchInput)
    return () => {
      debouncedSetSearch.cancel()
    }
  }, [searchInput, debouncedSetSearch])

  const handleStatusChange = (value: string) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      if (value !== 'all') {
        newParams.set('status', value)
      } else {
        newParams.delete('status')
      }
      newParams.set('page', '1')
      return newParams
    })
  }

  const handleSortChange = (value: string) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      newParams.set('sort', value)
      return newParams
    })
  }

  const handlePageSizeChange = (value: string) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      newParams.set('page_size', value)
      newParams.set('page', '1')
      return newParams
    })
  }

  const handleClearFilters = () => {
    setSearchInput('')
    setSearchParams({})
  }

  const handlePageChange = (newPage: number) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      newParams.set('page', newPage.toString())
      return newParams
    })
  }

  const total = data?.total || 0
  const totalPages = Math.ceil(total / pageSize)

  return (
    <ContentShell>
      <PageHeader
        title="User Groups"
        description="Manage user group risk limits and trading permissions"
        actions={
          <div className="flex items-center gap-2">
            {canCreateGroups && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Group
              </Button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="sticky top-0 z-10 bg-surface-1 border-b border-border p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Search by name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Name</SelectItem>
              <SelectItem value="created_desc">Created</SelectItem>
            </SelectContent>
          </Select>

          <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="pt-4">
      {isLoading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center">
          <p className="text-danger mb-2">Failed to load groups</p>
          <p className="text-sm text-text-muted">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      ) : displayGroups.length === 0 ? (
        <EmptyState
          title="No groups found"
          description="Create your first user group to get started"
          action={
            canCreateGroups ? (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Group
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <GroupsTable
            groups={displayGroups}
            availablePriceProfiles={availablePriceProfiles}
            allTags={allTags}
            onGroupUpdate={handleGroupUpdate}
            onRefresh={() => refetch()}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-border">
              <div className="text-sm text-text-muted">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} groups
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-text">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      </div>

      {/* Create Dialog */}
      <GroupFormDialog
        mode="create"
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
          if (!open) {
            refetch()
          }
        }}
      />
    </ContentShell>
  )
}
