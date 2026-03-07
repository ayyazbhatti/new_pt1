import { useState, useMemo } from 'react'
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
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export function AdminMarkupPage() {
  const openModal = useModalStore((state) => state.openModal)
  const canCreate = useCanAccess('markup:create')
  const canEdit = useCanAccess('markup:edit')
  const canDelete = useCanAccess('markup:delete')
  const { data: profiles, isLoading, error } = useMarkupProfiles()
  const [searchTerm, setSearchTerm] = useState('')

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
                  <td colSpan={4} className="px-4 py-12 text-center text-sm text-text-muted">
                    No price streams found.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((profile) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ContentShell>
  )
}
