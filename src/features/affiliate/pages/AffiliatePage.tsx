import { useState, useMemo, useEffect } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { DataTable } from '@/shared/ui/table'
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Users,
} from 'lucide-react'
import {
  useAffiliateLayers,
  useCreateAffiliateLayer,
  useUpdateAffiliateLayer,
  useDeleteAffiliateLayer,
} from '../hooks/useAffiliateLayers'
import { useAffiliateUsers } from '../hooks/useAffiliateUsers'
import type { AffiliateLayer } from '../api/affiliateLayers.api'
import type { AffiliateUser } from '../api/affiliateUsers.api'

export type { AffiliateLayer }

function displayName(user: AffiliateUser): string {
  const parts = [user.firstName, user.lastName].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.email
}

const affiliateUserColumns: ColumnDef<AffiliateUser>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <span className="font-medium text-text">
        {displayName(row.original) || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => (
      <span className="text-text-muted">{row.original.email}</span>
    ),
  },
  {
    accessorKey: 'referralCode',
    header: 'Referral code',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-text">
        {row.original.referralCode ?? '—'}
      </span>
    ),
  },
  {
    accessorKey: 'level',
    header: 'Level',
    cell: ({ row }) => (
      <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
        {row.original.level}
      </span>
    ),
  },
  {
    accessorKey: 'commissionPercent',
    header: 'Commission %',
    cell: ({ row }) => (
      <span className="text-right text-text">
        {row.original.commissionPercent}%
      </span>
    ),
    meta: { className: 'text-right' },
  },
  {
    accessorKey: 'referredCount',
    header: 'Referred',
    cell: ({ row }) => (
      <span className="text-right font-medium text-text">
        {row.original.referredCount}
      </span>
    ),
    meta: { className: 'text-right' },
  },
]

export function AffiliatePage() {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCommission, setEditCommission] = useState<string>('')
  const [usersPage, setUsersPage] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(20)

  const { data: layers = [], isLoading, error } = useAffiliateLayers()
  const {
    data: affiliateUsers = [],
    isLoading: usersLoading,
    error: usersError,
  } = useAffiliateUsers()

  const affiliateUsersPaginated = useMemo(() => {
    const start = (usersPage - 1) * usersPageSize
    return affiliateUsers.slice(start, start + usersPageSize)
  }, [affiliateUsers, usersPage, usersPageSize])

  useEffect(() => {
    const totalPages = Math.ceil(affiliateUsers.length / usersPageSize) || 1
    if (usersPage > totalPages) setUsersPage(1)
  }, [affiliateUsers.length, usersPageSize, usersPage])

  const createMutation = useCreateAffiliateLayer()
  const updateMutation = useUpdateAffiliateLayer()
  const deleteMutation = useDeleteAffiliateLayer()

  const handleAddLayer = () => {
    const nextLevel = layers.length + 1
    createMutation.mutate({
      name: `Level ${nextLevel}`,
      commission_percent: 0,
    })
  }

  const handleStartEdit = (layer: AffiliateLayer) => {
    setEditingId(layer.id)
    setEditCommission(String(layer.commissionPercent))
  }

  const handleSaveEdit = () => {
    if (editingId == null) return
    const value = parseFloat(editCommission)
    const commissionPercent = Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : 0
    updateMutation.mutate(
      { id: editingId, payload: { commission_percent: commissionPercent } },
      {
        onSuccess: () => {
          setEditingId(null)
          setEditCommission('')
        },
      }
    )
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditCommission('')
  }

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        if (editingId === id) {
          setEditingId(null)
          setEditCommission('')
        }
      },
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Affiliate"
        description="Affiliate users, commission layers, and payout structure"
      />

      {/* Commission layers */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">
            Commission layers
          </h2>
          <Button
            onClick={() => handleAddLayer()}
            size="sm"
            disabled={createMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add layer
          </Button>
        </div>
        <Card className="overflow-hidden">
          {error && (
            <div className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">
              {(error as Error).message}
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              Loading layers…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-text-muted">
                      Layer
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-text-muted">
                      Commission (%)
                    </th>
                    <th className="w-28 px-4 py-3 text-right font-medium text-text-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {layers.map((layer) => (
                    <tr key={layer.id} className="hover:bg-surface-2/30">
                      <td className="px-4 py-3 font-medium text-text">
                        {layer.name}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === layer.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={editCommission}
                              onChange={(e) =>
                                setEditCommission(e.target.value)}
                              className="w-24"
                              autoFocus
                            />
                            <span className="text-text-muted">%</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleSaveEdit}
                              disabled={updateMutation.isPending}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleCancelEdit}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <span className="text-text">
                            {layer.commissionPercent}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingId === layer.id ? null : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(layer)}
                              className="rounded p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
                              title="Edit commission"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(layer.id)}
                              disabled={deleteMutation.isPending}
                              className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                              title="Delete layer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && layers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Layers className="mb-3 h-10 w-10 text-text-muted/50" />
              <p className="text-sm font-medium text-text-muted">
                No layers yet
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Add a layer and set its commission %.
              </p>
              <Button
                onClick={() => handleAddLayer()}
                size="sm"
                className="mt-4"
                disabled={createMutation.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add layer
              </Button>
            </div>
          )}
          {!isLoading && layers.length > 0 && (
            <p className="border-t border-border px-4 py-2 text-xs text-text-muted">
              Layers are saved to the server. Changes apply to future commission
              calculations.
            </p>
          )}
        </Card>
      </section>

      {/* Affiliate users table */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-text">
          Affiliate users
        </h2>
        <Card className="overflow-hidden">
          {usersError && (
            <div className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">
              {(usersError as Error).message}
            </div>
          )}
          {usersLoading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              Loading affiliate users…
            </div>
          ) : (
            <DataTable<AffiliateUser>
                data={affiliateUsersPaginated}
                columns={affiliateUserColumns}
                bordered={false}
                pagination={{
                  page: usersPage,
                  pageSize: usersPageSize,
                  total: affiliateUsers.length,
                  onPageChange: setUsersPage,
                  onPageSizeChange: (size) => {
                    setUsersPageSize(size)
                    setUsersPage(1)
                },
              }}
            />
          )}
          {!usersLoading && affiliateUsers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-3 h-10 w-10 text-text-muted/50" />
              <p className="text-sm font-medium text-text-muted">
                No affiliate users yet
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Users who have a referral code appear here once they sign up.
              </p>
            </div>
          )}
        </Card>
      </section>
    </ContentShell>
  )
}
