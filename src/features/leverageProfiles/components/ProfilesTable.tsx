import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/shared/ui/table'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { LeverageProfile } from '../types/leverageProfile'
import { ProfileDetailsDialog } from './ProfileDetailsDialog'
import { ProfileFormDialog } from './ProfileFormDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { Eye, Edit, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'

interface ProfilesTableProps {
  profiles: LeverageProfile[]
  onRefresh?: () => void
}

export function ProfilesTable({ profiles, onRefresh }: ProfilesTableProps) {
  const [viewingProfile, setViewingProfile] = useState<LeverageProfile | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<LeverageProfile | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState<LeverageProfile | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const handleView = (profile: LeverageProfile) => {
    setViewingProfile(profile)
    setViewDialogOpen(true)
  }

  const handleEdit = (profile: LeverageProfile) => {
    setEditingProfile(profile)
    setEditDialogOpen(true)
  }

  const handleDelete = (profile: LeverageProfile) => {
    setDeletingProfile(profile)
    setDeleteDialogOpen(true)
  }

  const columns: ColumnDef<LeverageProfile>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const profile = row.original
        return (
          <div>
            <div className="font-semibold text-text">{profile.name}</div>
            {profile.description && (
              <div className="text-xs text-text-muted mt-0.5">{profile.description}</div>
            )}
          </div>
        )
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
      accessorKey: 'tiersCount',
      header: 'Tiers',
      cell: ({ row }) => {
        return <span className="text-text">{row.getValue('tiersCount')}</span>
      },
    },
    {
      accessorKey: 'symbolsCount',
      header: 'Symbols',
      cell: ({ row }) => {
        return <span className="text-text">{row.getValue('symbolsCount')}</span>
      },
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ row }) => {
        const date = row.getValue('updatedAt') as string
        return (
          <span className="text-text-muted text-sm">
            {formatDistanceToNow(new Date(date), { addSuffix: true })}
          </span>
        )
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
              onClick={() => handleView(profile)}
              title="View"
            >
              <Eye className="h-4 w-4" />
            </Button>
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
              onClick={() => handleDelete(profile)}
              title="Delete"
              className="text-danger hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <>
      <DataTable data={profiles} columns={columns} />
      
      {viewingProfile && (
        <ProfileDetailsDialog
          profile={viewingProfile}
          open={viewDialogOpen}
          onOpenChange={(open) => {
            setViewDialogOpen(open)
            if (!open) {
              setViewingProfile(null)
              onRefresh?.()
            }
          }}
        />
      )}

      {editingProfile && (
        <ProfileFormDialog
          mode="edit"
          initial={editingProfile}
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open)
            if (!open) {
              setEditingProfile(null)
              onRefresh?.()
            }
          }}
        />
      )}

      {deletingProfile && (
        <DeleteProfileDialog
          profile={deletingProfile}
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open)
            if (!open) {
              setDeletingProfile(null)
              onRefresh?.()
            }
          }}
        />
      )}
    </>
  )
}
