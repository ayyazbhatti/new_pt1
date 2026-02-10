import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Badge } from '@/shared/ui/badge'
import { MarkupProfile } from '../types/markup'
import { useModalStore } from '@/app/store'
import { ProfileDetailsModal } from '../modals/ProfileDetailsModal'
import { formatDistanceToNow } from 'date-fns'

interface ProfilesTableProps {
  profiles: MarkupProfile[]
  isLoading?: boolean
}

export function ProfilesTable({ profiles, isLoading }: ProfilesTableProps) {
  const openModal = useModalStore((state) => state.openModal)

  const handleRowClick = (profile: MarkupProfile) => {
    openModal(`profile-details-${profile.id}`, <ProfileDetailsModal profile={profile} />, {
      title: `Profile: ${profile.name}`,
      size: 'xl',
    })
  }

  const formatMarkup = (value: string, type: string) => {
    const num = parseFloat(value)
    const suffix = type === 'pips' ? ' pips' : type === 'points' ? ' pts' : '%'
    return `${num >= 0 ? '+' : ''}${num.toFixed(type === 'pips' ? 2 : 4)}${suffix}`
  }

  const columns: ColumnDef<MarkupProfile>[] = [
    {
      accessorKey: 'name',
      header: 'Profile Name',
      cell: ({ row }) => {
        const profile = row.original
        return (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text">{profile.name}</span>
            {profile.groupName && (
              <Badge variant="neutral" className="text-xs">
                {profile.groupName}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => {
        const desc = row.getValue('description') as string | null
        return (
          <span className="text-sm text-text-muted">{desc || '-'}</span>
        )
      },
    },
    {
      accessorKey: 'markupType',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('markupType') as string
        return (
          <Badge variant="info" className="text-xs capitalize">
            {type}
          </Badge>
        )
      },
    },
    {
      id: 'bidMarkup',
      header: 'Bid Markup',
      cell: ({ row }) => {
        const profile = row.original
        return (
          <span className="font-mono text-sm text-text">
            {formatMarkup(profile.bidMarkup, profile.markupType)}
          </span>
        )
      },
    },
    {
      id: 'askMarkup',
      header: 'Ask Markup',
      cell: ({ row }) => {
        const profile = row.original
        return (
          <span className="font-mono text-sm text-text">
            {formatMarkup(profile.askMarkup, profile.markupType)}
          </span>
        )
      },
    },
    {
      id: 'group',
      header: 'Group',
      cell: ({ row }) => {
        const groupName = row.original.groupName
        return (
          <span className="text-sm text-text-muted">{groupName || 'No Group'}</span>
        )
      },
    },
    {
      accessorKey: 'updatedAt',
      header: 'Last Updated',
      cell: ({ row }) => {
        const date = row.getValue('updatedAt') as string
        return (
          <span className="text-sm text-text-muted">
            {formatDistanceToNow(new Date(date), { addSuffix: true })}
          </span>
        )
      },
    },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-muted">Loading profiles...</div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <DataTable
        data={profiles}
        columns={columns}
        onRowClick={handleRowClick}
      />
    </div>
  )
}

