import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Settings, Edit, Archive, ArchiveRestore, Trash2, CheckCircle, Tag } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { LeverageProfile } from '../types/leverageProfile'
import { useLeverageProfileTiers, useDeleteLeverageTier } from '../hooks/useLeverageProfiles'
import { useCanAccess } from '@/shared/utils/permissions'
import { TiersTable } from './TiersTable'
import { cn } from '@/shared/utils'
import { formatDistanceToNow } from 'date-fns'
import { Spinner } from '@/shared/ui/loading'
import { Checkbox } from '@/shared/ui/Checkbox'
import { setLeverageProfileTags } from '../api/leverageProfiles.api'
import { toast } from '@/shared/components/common'

interface LeverageProfileCardProps {
  profile: LeverageProfile
  onManageTiers: (profile: LeverageProfile) => void
  onEdit: (profile: LeverageProfile) => void
  onArchive: (profile: LeverageProfile) => void
  onUnarchive: (profile: LeverageProfile) => void
  onDelete: (profile: LeverageProfile) => void
  /** All tags for the assign-tags dropdown */
  allTags?: { id: string; name: string }[]
  onProfileUpdate?: (profileId: string, updates: Partial<Pick<LeverageProfile, 'tagIds'>>) => void
  onRefresh?: () => void
  archiveLoading?: boolean
}

export function LeverageProfileCard({
  profile,
  onManageTiers,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  allTags = [],
  onProfileUpdate,
  onRefresh,
  archiveLoading = false,
}: LeverageProfileCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [openTagsDropdown, setOpenTagsDropdown] = useState(false)
  const [openTagsAnchorRect, setOpenTagsAnchorRect] = useState<DOMRect | null>(null)
  const [updatingTags, setUpdatingTags] = useState(false)
  const tagsDropdownRef = useRef<HTMLDivElement>(null)
  const { data: tiers, isLoading: tiersLoading } = useLeverageProfileTiers(profile.id, expanded)
  const deleteTier = useDeleteLeverageTier()
  const canEdit = useCanAccess('leverage_profiles:edit')
  const canDelete = useCanAccess('leverage_profiles:delete')
  const canTags = useCanAccess('leverage_profiles:edit')
  const isArchived = profile.status === 'disabled'
  const displayStatus = isArchived ? 'Archived' : 'Active'
  const tagIds = profile.tagIds ?? []

  useEffect(() => {
    if (!openTagsDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node)) {
        setOpenTagsDropdown(false)
        setOpenTagsAnchorRect(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openTagsDropdown])

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div
        className="flex flex-wrap items-center gap-3 p-4 sm:p-5 cursor-pointer hover:bg-surface-2 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-text-muted">
          {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-medium text-text">{profile.name}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
                isArchived
                  ? 'bg-surface-2 text-text-muted border-border'
                  : 'bg-green-900/50 text-green-400 border-green-500/30'
              )}
            >
              {isArchived ? <Archive className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
              {displayStatus}
            </span>
            <span className="text-xs text-text-muted border border-border rounded px-2 py-0.5">
              v{1}
            </span>
            <span className="text-xs text-text-muted">
              Updated {formatDistanceToNow(new Date(profile.updatedAt), { addSuffix: true })}
            </span>
            {profile.createdByEmail && (
              <span className="text-xs text-text-muted" title="Created by">
                Created by {profile.createdByEmail}
              </span>
            )}
          </div>
          {profile.description && (
            <p className="mt-1 text-sm italic text-text-muted">{profile.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canTags && (
            <Button
              variant="ghost"
              size="sm"
              className="text-text-muted hover:text-text hover:bg-surface-2 border border-border gap-1.5"
              disabled={updatingTags}
              onClick={(e) => {
                e.stopPropagation()
                if (openTagsDropdown) {
                  setOpenTagsDropdown(false)
                  setOpenTagsAnchorRect(null)
                } else {
                  setOpenTagsDropdown(true)
                  setOpenTagsAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect())
                }
              }}
            >
              {updatingTags && <Spinner className="h-3.5 w-3.5 shrink-0" />}
              <Tag className="h-4 w-4 shrink-0" />
              <span className="max-w-[90px] truncate">
                {tagIds.length > 0 ? `${tagIds.length} tag${tagIds.length === 1 ? '' : 's'}` : 'Assign tags'}
              </span>
              <ChevronDown
                className={cn('h-4 w-4 shrink-0 transition-transform', openTagsDropdown && 'rotate-180')}
              />
            </Button>
          )}
          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-text-muted hover:text-text hover:bg-surface-2 border border-border"
                onClick={() => onManageTiers(profile)}
              >
                <Settings className="h-4 w-4 mr-1" />
                Manage Tiers
              </Button>
              <Button variant="ghost" size="sm" className="text-text-muted hover:text-text p-2" onClick={() => onEdit(profile)} title="Edit">
                <Edit className="h-4 w-4" />
              </Button>
              {isArchived ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-muted hover:text-green-400 p-2"
                  onClick={() => onUnarchive(profile)}
                  disabled={archiveLoading}
                  title="Unarchive"
                >
                  <ArchiveRestore className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-muted hover:text-yellow-400 p-2"
                  onClick={() => onArchive(profile)}
                  disabled={archiveLoading}
                  title="Archive"
                >
                  <Archive className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" className="text-text-muted hover:text-red-400 p-2" onClick={() => onDelete(profile)} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {openTagsDropdown && openTagsAnchorRect &&
        createPortal(
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
                      checked={tagIds.includes(tag.id)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        const next = checked
                          ? [...tagIds, tag.id]
                          : tagIds.filter((id) => id !== tag.id)
                        setUpdatingTags(true)
                        setLeverageProfileTags(profile.id, next)
                          .then(() => {
                            onProfileUpdate?.(profile.id, { tagIds: next })
                            onRefresh?.()
                            toast.success('Tags updated')
                          })
                          .catch(() => toast.error('Failed to update tags'))
                          .finally(() => setUpdatingTags(false))
                      }}
                    />
                    <span className="text-text">{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}

      {expanded && (
        <div className="border-t border-border bg-surface-2 p-4">
          {tiersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-8 w-8 text-text-muted" />
            </div>
          ) : !tiers || tiers.length === 0 ? (
            <p className="text-sm text-text-muted py-4 text-center">No tiers configured for this profile.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <TiersTable
                tiers={tiers}
                onTierEdit={canEdit ? () => onManageTiers(profile) : undefined}
                onTierDelete={canEdit ? (tierId) => deleteTier.mutate({ profileId: profile.id, tierId }) : undefined}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
