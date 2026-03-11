import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { ContentShell, PageHeader } from '@/shared/layout'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { useMarkupProfiles } from '../hooks/useMarkup'
import { MarkupProfile } from '../types/markup'
import { CreateEditPriceStreamModal } from '../modals/CreateEditPriceStreamModal'
import { DeletePriceStreamModal } from '../modals/DeletePriceStreamModal'
import { TransferSettingsModal } from '../modals/TransferSettingsModal'
import { ConfigureMarkupsModal } from '../modals/ConfigureMarkupsModal'
import { Button } from '@/shared/ui/button'
import {
  Plus,
  Search,
  X,
  Settings,
  Copy,
  Pencil,
  Trash2,
  Tag,
  ChevronDown,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { listTags } from '@/features/tags/api/tags.api'
import { Checkbox } from '@/shared/ui/Checkbox'
import { setMarkupProfileTags } from '../api/markup.api'
import { toast } from '@/shared/components/common'
import { cn } from '@/shared/utils'
import { Spinner } from '@/shared/ui/loading'

export function AdminMarkupPage() {
  const openModal = useModalStore((state) => state.openModal)
  const canCreate = useCanAccess('markup:create')
  const canEdit = useCanAccess('markup:edit')
  const canDelete = useCanAccess('markup:delete')
  const canTags = useCanAccess('markup:edit')
  const { data: profiles, isLoading, error, refetch } = useMarkupProfiles()
  const { data: tagsList = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => listTags(),
  })
  const allTags = useMemo(() => tagsList.map((t) => ({ id: t.id, name: t.name })), [tagsList])
  const [searchTerm, setSearchTerm] = useState('')
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

  const filteredProfiles = useMemo(() => {
    if (!profiles) return []
    const term = searchTerm.trim().toLowerCase()
    if (!term) return profiles
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.groupName?.toLowerCase().includes(term) ?? false)
    )
  }, [profiles, searchTerm])

  const handleNewStream = () => {
    openModal('create-price-stream', <CreateEditPriceStreamModal />, {
      title: 'Create Price Stream',
      size: 'md',
    })
  }

  const handleEdit = (profile: MarkupProfile) => {
    openModal(
      `edit-price-stream-${profile.id}`,
      <CreateEditPriceStreamModal stream={profile} />,
      { title: 'Edit Price Stream', size: 'md' }
    )
  }

  const handleDelete = (profile: MarkupProfile) => {
    openModal(
      `delete-price-stream-${profile.id}`,
      <DeletePriceStreamModal stream={profile} />,
      { title: '', size: 'md' }
    )
  }

  const handleTransferSettings = (profile: MarkupProfile) => {
    openModal(
      `transfer-settings-${profile.id}`,
      <TransferSettingsModal sourceStream={profile} />,
      { title: 'Transfer Price Stream Settings', size: 'lg' }
    )
  }

  const handleConfigureMarkups = (profile: MarkupProfile) => {
    openModal(
      `configure-markups-${profile.id}`,
      <ConfigureMarkupsModal stream={profile} />,
      {
        title: '',
        size: 'content',
        className:
          '!p-0 !gap-0 !bg-slate-800 !border-slate-700 !rounded-xl max-h-[95vh] overflow-hidden flex flex-col [&>button]:hidden [&>div:first-child]:hidden [&>div:last-child]:flex-1 [&>div:last-child]:min-h-0',
      }
    )
  }

  if (isLoading) {
    return (
      <ContentShell>
        <PageHeader title="Price Streams Management" description="Manage price stream configurations" />
        <div className="flex items-center justify-center h-64 p-4 sm:p-6">
          <p className="text-sm text-text-muted">Loading price streams...</p>
        </div>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <PageHeader title="Price Streams Management" description="Manage price stream configurations" />
        <p className="text-sm text-danger">Failed to load price streams</p>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Price Streams Management"
        description="Manage price stream configurations"
        actions={
          canCreate ? (
            <Button onClick={handleNewStream}>
              <Plus className="h-4 w-4 mr-2" />
              New Stream
            </Button>
          ) : undefined
        }
      />
      {/* Search */}
      <div className="mb-6 flex items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search price streams..."
            className="w-full rounded-lg border border-border bg-surface-2 pl-10 pr-10 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                  Groups
                </th>
                {canTags && (
                  <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                    Tags
                  </th>
                )}
                <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                  Created by
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-muted">
                  Created At
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={canTags ? 6 : 5} className="px-4 py-12 text-center text-sm text-text-muted">
                    No price streams found.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((profile) => {
                  const tagIds = profile.tagIds ?? []
                  const isOpen = openTagsProfileId === profile.id
                  const isUpdating = updatingTagsProfileId === profile.id
                  const tagsLabel =
                    tagIds.length > 0
                      ? `${tagIds.length} tag${tagIds.length === 1 ? '' : 's'}`
                      : 'Assign tags'
                  return (
                  <tr
                    key={profile.id}
                    className="border-b border-border hover:bg-white/5"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-text">
                      {profile.name}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {profile.groupName ? (
                        <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                          {profile.groupName}
                        </span>
                      ) : (
                        <span className="text-text-muted">Unassigned</span>
                      )}
                    </td>
                    {canTags && (
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-text"
                          disabled={isUpdating}
                          onClick={(e) => {
                            if (isOpen) {
                              setOpenTagsProfileId(null)
                              setOpenTagsAnchorRect(null)
                            } else {
                              setOpenTagsProfileId(profile.id)
                              setOpenTagsAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect())
                            }
                          }}
                        >
                          {isUpdating && <Spinner className="h-3.5 w-3.5 shrink-0" />}
                          <Tag className="h-4 w-4 shrink-0" />
                          <span className="max-w-[80px] truncate">{tagsLabel}</span>
                          <ChevronDown
                            className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')}
                          />
                        </Button>
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {profile.createdByEmail ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {profile.createdAt
                        ? formatDistanceToNow(new Date(profile.createdAt), {
                            addSuffix: true,
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleConfigureMarkups(profile)}
                              className="rounded-lg p-2 text-accent hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Configure Markups"
                            >
                              <Settings className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTransferSettings(profile)}
                              className="rounded-lg p-2 text-teal-400 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Transfer Settings"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEdit(profile)}
                              className="rounded-lg p-2 text-text-muted hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Edit Stream"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(profile)}
                            className="rounded-lg p-2 text-danger hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Delete Stream"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openTagsProfileId && openTagsAnchorRect &&
        (() => {
          const openTagsTagIds = filteredProfiles.find((p) => p.id === openTagsProfileId)?.tagIds ?? []
          return createPortal(
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
                          setMarkupProfileTags(openTagsProfileId, next)
                            .then(() => {
                              refetch()
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
        })()}
    </ContentShell>
  )
}
