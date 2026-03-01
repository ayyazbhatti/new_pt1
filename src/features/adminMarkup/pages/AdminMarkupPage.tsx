import { useState, useMemo } from 'react'
import { ContentShell } from '@/shared/layout'
import { useModalStore } from '@/app/store'
import { useMarkupProfiles } from '../hooks/useMarkup'
import { MarkupProfile } from '../types/markup'
import { CreateEditPriceStreamModal } from '../modals/CreateEditPriceStreamModal'
import { DeletePriceStreamModal } from '../modals/DeletePriceStreamModal'
import { TransferSettingsModal } from '../modals/TransferSettingsModal'
import { ConfigureMarkupsModal } from '../modals/ConfigureMarkupsModal'
import {
  Plus,
  Search,
  X,
  Upload,
  Settings,
  Copy,
  Pencil,
  Trash2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export function AdminMarkupPage() {
  const openModal = useModalStore((state) => state.openModal)
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
      { title: '', size: 'lg' }
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

  const handlePublish = (_profile: MarkupProfile) => {
    // Placeholder: Publish to DataProvider
  }

  if (isLoading) {
    return (
      <ContentShell className="bg-slate-900 min-h-[calc(100vh-8rem)] rounded-lg border border-slate-700/50">
        <div className="flex items-center justify-center h-64 p-4 sm:p-6">
          <p className="text-sm sm:text-base text-slate-400">
            Loading price streams...
          </p>
        </div>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell className="bg-slate-900 min-h-[calc(100vh-8rem)] rounded-lg border border-slate-700/50">
        <div className="flex items-center justify-center h-64 p-4 sm:p-6">
          <p className="text-red-400 text-sm sm:text-base">
            Failed to load price streams
          </p>
        </div>
      </ContentShell>
    )
  }

  return (
    <ContentShell className="space-y-4 sm:space-y-6 bg-slate-900 text-white min-h-[calc(100vh-8rem)] rounded-lg border border-slate-700/50">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">
            Price Streams Management
          </h1>
          <p className="text-sm sm:text-base text-slate-400 mt-0.5">
            Manage price stream configurations
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewStream}
          className="flex items-center justify-center sm:justify-start space-x-2 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm sm:text-base w-full sm:w-auto"
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          <span>New Stream</span>
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center space-x-4">
        <div className="relative flex-1 w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search price streams..."
            className="w-full pl-10 pr-10 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border border-slate-600 rounded-lg overflow-hidden bg-slate-800/50">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-600 bg-slate-800">
                <th className="text-left py-3 px-4 text-slate-300 font-medium text-sm">
                  Name
                </th>
                <th className="text-left py-3 px-4 text-slate-300 font-medium text-sm">
                  Groups
                </th>
                <th className="text-left py-3 px-4 text-slate-300 font-medium text-sm">
                  Created At
                </th>
                <th className="text-right py-3 px-4 text-slate-300 font-medium text-sm">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-12 text-center text-slate-400 text-sm"
                  >
                    No price streams found.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((profile) => (
                  <tr
                    key={profile.id}
                    className="border-b border-slate-700 hover:bg-slate-700/30"
                  >
                    <td className="py-3 px-4">
                      <span className="font-medium text-white">
                        {profile.name}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {profile.groupName ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-200">
                          {profile.groupName}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-sm">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-sm">
                      {profile.createdAt
                        ? formatDistanceToNow(new Date(profile.createdAt), {
                            addSuffix: true,
                          })
                        : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handlePublish(profile)}
                          className="p-2 rounded-lg hover:bg-slate-700 text-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Publish to DataProvider"
                        >
                          <Upload className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfigureMarkups(profile)}
                          className="p-2 rounded-lg hover:bg-slate-700 text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Configure Markups"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTransferSettings(profile)}
                          className="p-2 rounded-lg hover:bg-slate-700 text-teal-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Transfer Settings"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(profile)}
                          className="p-2 rounded-lg hover:bg-slate-700 text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Edit Stream"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(profile)}
                          className="p-2 rounded-lg hover:bg-slate-700 text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete Stream"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
