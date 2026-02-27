import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings, Edit, Archive, ArchiveRestore, Trash2, CheckCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { LeverageProfile } from '../types/leverageProfile'
import { useLeverageProfileTiers, useDeleteLeverageTier } from '../hooks/useLeverageProfiles'
import { TiersTable } from './TiersTable'
import { cn } from '@/shared/utils'
import { formatDistanceToNow } from 'date-fns'
import { Spinner } from '@/shared/ui/loading'

interface LeverageProfileCardProps {
  profile: LeverageProfile
  onManageTiers: (profile: LeverageProfile) => void
  onEdit: (profile: LeverageProfile) => void
  onArchive: (profile: LeverageProfile) => void
  onUnarchive: (profile: LeverageProfile) => void
  onDelete: (profile: LeverageProfile) => void
  archiveLoading?: boolean
}

export function LeverageProfileCard({
  profile,
  onManageTiers,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  archiveLoading = false,
}: LeverageProfileCardProps) {
  const [expanded, setExpanded] = useState(false)
  const { data: tiers, isLoading: tiersLoading } = useLeverageProfileTiers(profile.id, expanded)
  const deleteTier = useDeleteLeverageTier()
  const isArchived = profile.status === 'disabled'
  const displayStatus = isArchived ? 'Archived' : 'Active'

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 overflow-hidden">
      <div
        className="flex flex-wrap items-center gap-3 p-4 sm:p-5 cursor-pointer hover:bg-slate-700/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-slate-400">
          {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-medium text-white">{profile.name}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
                isArchived
                  ? 'bg-slate-700/50 text-slate-400 border-slate-600/30'
                  : 'bg-green-900/50 text-green-400 border-green-500/30'
              )}
            >
              {isArchived ? <Archive className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
              {displayStatus}
            </span>
            <span className="text-xs text-slate-400 border border-slate-600/50 rounded px-2 py-0.5">
              v{1}
            </span>
            <span className="text-xs text-slate-400">
              Updated {formatDistanceToNow(new Date(profile.updatedAt), { addSuffix: true })}
            </span>
          </div>
          {profile.description && (
            <p className="mt-1 text-sm italic text-slate-400">{profile.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-300 hover:text-white hover:bg-slate-600 border border-slate-600"
            onClick={() => onManageTiers(profile)}
          >
            <Settings className="h-4 w-4 mr-1" />
            Manage Tiers
          </Button>
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white p-2" onClick={() => onEdit(profile)} title="Edit">
            <Edit className="h-4 w-4" />
          </Button>
          {isArchived ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-green-400 p-2"
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
              className="text-slate-400 hover:text-yellow-400 p-2"
              onClick={() => onArchive(profile)}
              disabled={archiveLoading}
              title="Archive"
            >
              <Archive className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-red-400 p-2" onClick={() => onDelete(profile)} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-700 bg-slate-800/80 p-4">
          {tiersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-8 w-8 text-slate-400" />
            </div>
          ) : !tiers || tiers.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No tiers configured for this profile.</p>
          ) : (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <TiersTable
                tiers={tiers}
                onTierEdit={() => onManageTiers(profile)}
                onTierDelete={(tierId) => deleteTier.mutate({ profileId: profile.id, tierId })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
