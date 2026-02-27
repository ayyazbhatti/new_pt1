import { useState, useCallback } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  type CreateTagPayload,
  type UpdateTagPayload,
} from '../api/tags.api'
import { TagFiltersBar } from '../components/TagFiltersBar'
import { TagSummaryCards } from '../components/TagSummaryCards'
import { TagsTable } from '../components/TagsTable'
import { CreateTagModal } from '../modals/CreateTagModal'
import { EditTagModal } from '../modals/EditTagModal'
import { DeleteTagModal } from '../modals/DeleteTagModal'
import type { Tag } from '../types/tag'
import { Plus } from 'lucide-react'
import { toast } from '@/shared/components/common'

const TAGS_QUERY_KEY = ['tags'] as const

export function TagsPage() {
  const queryClient = useQueryClient()
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const canEdit = useCanAccess('users:edit')

  const [filters, setFilters] = useState({ search: '' })

  const listParams = {
    search: filters.search.trim() || undefined,
  }

  const { data: tags = [], isLoading, error, refetch } = useQuery({
    queryKey: [...TAGS_QUERY_KEY, listParams],
    queryFn: () => listTags(listParams),
  })

  const createMutation = useMutation({
    mutationFn: (payload: CreateTagPayload) => createTag(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY })
      closeModal('create-tag')
      toast.success('Tag created.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
          ?.error?.message ?? (err as Error)?.message ?? 'Failed to create tag'
      toast.error(message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTagPayload }) =>
      updateTag(id, payload),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY })
      closeModal(`edit-tag-${id}`)
      toast.success('Tag updated.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
          ?.error?.message ?? (err as Error)?.message ?? 'Failed to update tag'
      toast.error(message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY })
      closeModal(`delete-tag-${id}`)
      toast.success('Tag deleted.')
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
          ?.error?.message ?? (err as Error)?.message ?? 'Failed to delete tag'
      toast.error(message)
    },
  })

  const hasActiveFilters = Boolean(filters.search.trim())

  const handleCreateTag = useCallback(() => {
    openModal(
      'create-tag',
      (
        <CreateTagModal
          onCreated={(payload) => createMutation.mutate(payload)}
        />
      ),
      {
        title: 'Create Tag',
        description: 'Add a new tag to assign to users and managers.',
        size: 'md',
      }
    )
  }, [openModal, createMutation])

  const handleEditTag = useCallback(
    (tag: Tag) => {
      openModal(
        `edit-tag-${tag.id}`,
        (
          <EditTagModal
            tag={tag}
            onSave={(payload) => updateMutation.mutate({ id: tag.id, payload })}
          />
        ),
        { title: 'Edit Tag', size: 'md' }
      )
    },
    [openModal, updateMutation]
  )

  const handleDeleteTag = useCallback(
    (tag: Tag) => {
      openModal(
        `delete-tag-${tag.id}`,
        (
          <DeleteTagModal
            tag={tag}
            onConfirm={() => deleteMutation.mutate(tag.id)}
          />
        ),
        { title: 'Delete Tag', size: 'sm' }
      )
    },
    [openModal, deleteMutation]
  )

  if (isLoading) {
    return (
      <ContentShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading tags...</div>
        </div>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-danger mb-2">Failed to load tags</div>
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
        title="Tags"
        description="Create and manage tags. Assign tags to users, managers, and other entities for filtering and organization."
        actions={
          canEdit ? (
            <Button onClick={handleCreateTag}>
              <Plus className="h-4 w-4 mr-2" />
              Create Tag
            </Button>
          ) : undefined
        }
      />
      <TagSummaryCards tags={tags} />
      <TagFiltersBar filters={filters} onFilterChange={setFilters} />
      <TagsTable
        tags={tags}
        onEdit={handleEditTag}
        onDelete={handleDeleteTag}
        hasActiveFilters={hasActiveFilters}
      />
    </ContentShell>
  )
}
