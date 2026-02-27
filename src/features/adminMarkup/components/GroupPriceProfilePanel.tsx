import { useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useModalStore } from '@/app/store'
import { AssignGroupProfileModal } from '../modals/AssignGroupProfileModal'
import { GroupPriceProfile } from '../types/pricing'
import { mockGroupProfiles } from '../mocks/groupProfiles.mock'
import { Edit } from 'lucide-react'
import { toast } from '@/shared/components/common'

export function GroupPriceProfilePanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [groupProfiles, setGroupProfiles] = useState<GroupPriceProfile[]>(mockGroupProfiles)

  const handleChangeProfile = (groupProfile: GroupPriceProfile) => {
    openModal(
      `assign-group-${groupProfile.groupId}`,
      <AssignGroupProfileModal groupProfile={groupProfile} />,
      {
        title: 'Assign Price Stream Profile',
        size: 'sm',
      }
    )
  }

  const columns: ColumnDef<GroupPriceProfile>[] = [
    {
      accessorKey: 'groupName',
      header: 'Group Name',
      cell: ({ row }) => {
        return <span className="font-semibold text-text">{row.getValue('groupName')}</span>
      },
    },
    {
      accessorKey: 'profileName',
      header: 'Default Price Profile',
      cell: ({ row }) => {
        const groupProfile = row.original
        return (
          <Select
            value={groupProfile.profileId}
            onValueChange={(value) => {
              // In real app, this would update the backend
              toast.success(`Profile updated for ${groupProfile.groupName}`)
            }}
          >
            <SelectTrigger className="w-[250px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* This would be populated from available profiles */}
              <SelectItem value={groupProfile.profileId}>{groupProfile.profileName}</SelectItem>
            </SelectContent>
          </Select>
        )
      },
    },
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: ({ row }) => {
        const notes = row.getValue('notes') as string | undefined
        return <span className="text-sm text-text-muted">{notes || '—'}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const groupProfile = row.original
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleChangeProfile(groupProfile)}
            title="Change Profile"
          >
            <Edit className="h-4 w-4 mr-2" />
            Change Profile
          </Button>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <p className="text-sm text-text-muted">
          Each user group must have one default price stream profile. This defines pricing for all symbols for users in that group.
        </p>
      </div>
      <DataTable data={groupProfiles} columns={columns} />
    </div>
  )
}

