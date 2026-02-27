import { useState, useMemo } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { useModalStore } from '@/app/store'
import { CreateEditProfileModal } from '../modals/CreateEditProfileModal'
import { PriceStreamProfile } from '../types/pricing'
import { mockPriceProfiles } from '../mocks/priceProfiles.mock'
import { Edit, X, Plus } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { formatDateTime } from '../utils/formatters'

export function PriceStreamProfilesPanel() {
  const openModal = useModalStore((state) => state.openModal)
  const [profiles, setProfiles] = useState<PriceStreamProfile[]>(mockPriceProfiles)

  const handleCreate = () => {
    openModal('create-profile', <CreateEditProfileModal />, {
      title: 'Create Price Stream Profile',
      size: 'md',
    })
  }

  const handleEdit = (profile: PriceStreamProfile) => {
    openModal(
      `edit-profile-${profile.id}`,
      <CreateEditProfileModal profile={profile} />,
      {
        title: 'Edit Price Stream Profile',
        size: 'md',
      }
    )
  }

  const handleDisable = (profile: PriceStreamProfile) => {
    setProfiles(
      profiles.map((p) =>
        p.id === profile.id
          ? { ...p, status: p.status === 'active' ? 'disabled' : 'active' }
          : p
      )
    )
    toast.success(`Profile ${profile.name} ${profile.status === 'active' ? 'disabled' : 'enabled'}`)
  }

  const columns: ColumnDef<PriceStreamProfile>[] = [
    {
      accessorKey: 'name',
      header: 'Profile Name',
      cell: ({ row }) => {
        return <span className="font-semibold text-text">{row.getValue('name')}</span>
      },
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{row.getValue('description')}</span>
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variant = status === 'active' ? 'success' : 'danger'
        return <Badge variant={variant}>{status}</Badge>
      },
    },
    {
      accessorKey: 'createdBy',
      header: 'Created By',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{row.getValue('createdBy')}</span>
      },
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated At',
      cell: ({ row }) => {
        return <span className="text-sm text-text-muted">{formatDateTime(row.getValue('updatedAt'))}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const profile = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(profile)}
              title="Edit"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDisable(profile)}
              title={profile.status === 'active' ? 'Disable' : 'Enable'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-text-muted mb-2">
            <strong className="text-text">Platform is bid/ask based.</strong> Markups affect trader entry price, PnL, and margin.
          </p>
          <p className="text-xs text-text-muted">
            Bid markup reduces or increases bid price before distribution. Ask markup applies independently to ask price.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Profile
        </Button>
      </div>
      <DataTable data={profiles} columns={columns} />
    </div>
  )
}

