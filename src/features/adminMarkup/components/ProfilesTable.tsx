import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
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

  const columns: ColumnDef<MarkupProfile>[] = [
    {
      accessorKey: 'name',
      header: 'Profile Name',
      cell: ({ row }) => {
        const profile = row.original
        return <span className="font-semibold text-text">{profile.name}</span>
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

