import { useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ContentShell } from '@/shared/layout'
import { DataTable, type ColumnDef } from '@/shared/ui/table'
import {
  DollarSign,
  Users,
  TrendingUp,
  Plus,
  Search,
  X,
  Eye,
  Pencil,
  Trash2,
  CheckCircle,
} from 'lucide-react'
import { useCanAccess } from '@/shared/utils/permissions'
import { useAffiliateLayers } from '../hooks/useAffiliateLayers'
import { useAffiliateUsers } from '../hooks/useAffiliateUsers'
import type { AffiliateLayer } from '../api/affiliateLayers.api'
import type { AffiliateUser } from '../api/affiliateUsers.api'
import { CreateEditSchemeModal } from '../modals/CreateEditSchemeModal'
import { SchemeDetailsModal } from '../modals/SchemeDetailsModal'
import { DeleteSchemeModal } from '../modals/DeleteSchemeModal'
import { AffiliateDetailsModal } from '../modals/AffiliateDetailsModal'
import { DeleteAffiliateModal } from '../modals/DeleteAffiliateModal'
import { format } from 'date-fns'

type AdminTab = 'schemes' | 'affiliates' | 'referrals' | 'commissions'

const TABS: { id: AdminTab; label: string; icon: typeof DollarSign }[] = [
  { id: 'schemes', label: 'Schemes', icon: DollarSign },
  { id: 'affiliates', label: 'Affiliates', icon: Users },
  { id: 'referrals', label: 'Referrals', icon: TrendingUp },
  { id: 'commissions', label: 'Commissions', icon: DollarSign },
]

function shortId(id: string): string {
  return id && id.length >= 8 ? id.slice(0, 8) : id
}

// Placeholder types for Referrals / Commissions (UI only; no API yet)
interface PlaceholderReferral {
  id: string
  affiliateCode: string
  userId: string
  level: number
  attributedAt: string
}
interface PlaceholderCommission {
  id: string
  affiliateCode: string
  userId: string
  basis: 'Volume' | 'Spread' | 'Fee' | 'Deposit'
  amount: string
  status: 'Accrued' | 'Approved' | 'Paid'
  createdAt: string
}

const PLACEHOLDER_REFERRALS: PlaceholderReferral[] = []
const PLACEHOLDER_COMMISSIONS: PlaceholderCommission[] = []

const TAB_IDS: AdminTab[] = ['schemes', 'affiliates', 'referrals', 'commissions']

function tabFromParam(param: string | null): AdminTab {
  if (param && TAB_IDS.includes(param as AdminTab)) return param as AdminTab
  return 'schemes'
}

export function AffiliatePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = tabFromParam(searchParams.get('tab'))
  const setActiveTab = useCallback(
    (tab: AdminTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', tab)
        return next
      })
    },
    [setSearchParams]
  )
  const [search, setSearch] = useState('')
  const [schemeModal, setSchemeModal] = useState<'create' | null>(null)
  const [editingLayer, setEditingLayer] = useState<AffiliateLayer | null>(null)
  const [viewingScheme, setViewingScheme] = useState<AffiliateLayer | null>(null)
  const [deleteScheme, setDeleteScheme] = useState<AffiliateLayer | null>(null)
  const [viewingAffiliate, setViewingAffiliate] = useState<AffiliateUser | null>(null)
  const [deleteAffiliate, setDeleteAffiliate] = useState<AffiliateUser | null>(null)

  const canCreate = useCanAccess('affiliate:create')
  const canEdit = useCanAccess('affiliate:edit')
  const canDelete = useCanAccess('affiliate:delete')
  const { data: layers = [], isLoading: layersLoading } = useAffiliateLayers()
  const { data: users = [], isLoading: usersLoading } = useAffiliateUsers()

  const searchPlaceholder =
    activeTab === 'schemes'
      ? 'Search schemes...'
      : activeTab === 'affiliates'
        ? 'Search affiliates...'
        : activeTab === 'referrals'
          ? 'Search referrals...'
          : 'Search commissions...'

  const filteredLayers = useMemo(() => {
    if (!search.trim()) return layers
    const q = search.toLowerCase()
    return layers.filter((l) => l.name.toLowerCase().includes(q))
  }, [layers, search])

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) =>
        (u.referralCode && u.referralCode.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        (u.firstName && u.firstName.toLowerCase().includes(q)) ||
        (u.lastName && u.lastName.toLowerCase().includes(q))
    )
  }, [users, search])

  const isLoading =
    (activeTab === 'schemes' && layersLoading) ||
    (activeTab === 'affiliates' && usersLoading) ||
    (activeTab === 'referrals') ||
    (activeTab === 'commissions')

  const openEdit = (layer: AffiliateLayer) => {
    if (canEdit) {
      setEditingLayer(layer)
    }
  }

  const schemeColumns: ColumnDef<AffiliateLayer>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => {
          const layer = row.original
          return (
            <>
              <span className="font-medium text-text">{layer.name}</span>
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border border-border text-text-muted">
                1 level
              </span>
            </>
          )
        },
      },
      {
        id: 'commissionStructure',
        header: 'Commission Structure',
        cell: ({ row }) => (
          <span className="text-sm text-text-muted">
            Level 1: {row.original.commissionPercent}%
          </span>
        ),
      },
      {
        id: 'qualifiers',
        header: 'Qualifiers',
        cell: () => (
          <span className="text-sm text-text-muted">Min Active: 0 · Min Volume: $0</span>
        ),
      },
      {
        id: 'cookieDays',
        header: 'Cookie Days',
        cell: () => <span className="text-text-muted">0 days</span>,
      },
      {
        id: 'actions',
        header: () => <span className="text-right w-full block">Actions</span>,
        cell: ({ row }) => {
          const layer = row.original
          return (
            <div
              className="flex items-center justify-end gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setViewingScheme(layer)}
                className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text"
                title="View"
              >
                <Eye className="w-4 h-4" />
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditingLayer(layer)}
                  className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteScheme(layer)}
                  className="p-2 rounded-lg hover:bg-surface-2 text-red-500 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )
        },
      },
    ],
    [canEdit, canDelete]
  )

  const affiliateColumns: ColumnDef<AffiliateUser>[] = useMemo(
    () => [
      {
        id: 'code',
        header: 'Code',
        cell: ({ row }) => {
          const u = row.original
          const code = u.referralCode ?? shortId(u.id)
          return (
            <>
              <span className="font-mono font-medium text-text">{code}</span>
              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border border-border text-text-muted">
                —
              </span>
            </>
          )
        },
      },
      {
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => (
          <span className="text-text-muted">User {shortId(row.original.id)}</span>
        ),
      },
      {
        id: 'scheme',
        header: 'Scheme',
        cell: () => <span className="text-text-muted">—</span>,
      },
      {
        id: 'created',
        header: 'Created',
        cell: () => <span className="text-text-muted">—</span>,
      },
      {
        id: 'actions',
        header: () => <span className="text-right w-full block">Actions</span>,
        cell: ({ row }) => {
          const user = row.original
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => setViewingAffiliate(user)}
                className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text"
                title="View"
              >
                <Eye className="w-4 h-4" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteAffiliate(user)}
                  className="p-2 rounded-lg hover:bg-surface-2 text-red-500 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )
        },
      },
    ],
    [canEdit, canDelete]
  )

  const referralColumns: ColumnDef<PlaceholderReferral>[] = useMemo(
    () => [
      {
        accessorKey: 'affiliateCode',
        header: 'Affiliate',
        cell: ({ row }) => (
          <span className="font-mono text-text-muted">{row.original.affiliateCode}</span>
        ),
      },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <span className="text-text-muted">User {shortId(row.original.userId)}</span>
        ),
      },
      {
        id: 'level',
        header: 'Level',
        cell: ({ row }) => (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border border-border text-text-muted">
            Level {row.original.level}
          </span>
        ),
      },
      {
        accessorKey: 'attributedAt',
        header: 'Attributed',
        cell: ({ row }) => (
          <span className="text-text-muted">
            {format(new Date(row.original.attributedAt), 'PP')}
          </span>
        ),
      },
    ],
    []
  )

  const commissionColumns: ColumnDef<PlaceholderCommission>[] = useMemo(
    () => [
      {
        accessorKey: 'affiliateCode',
        header: 'Affiliate',
        cell: ({ row }) => (
          <span className="font-mono text-text-muted">{row.original.affiliateCode}</span>
        ),
      },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <span className="text-text-muted">User {shortId(row.original.userId)}</span>
        ),
      },
      {
        accessorKey: 'basis',
        header: 'Basis',
        cell: ({ row }) => (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border border-border text-text-muted">
            {row.original.basis}
          </span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => (
          <span className="font-mono text-text">{row.original.amount} USD</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border">
            {row.original.status}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-text-muted">
            {format(new Date(row.original.createdAt), 'PP')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="text-right w-full block">Actions</span>,
        cell: ({ row }) => {
          const c = row.original
          return (
            <div className="flex items-center justify-end gap-1">
              {c.status === 'Accrued' && (
                <button
                  type="button"
                  className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30"
                >
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Approve
                </button>
              )}
              {c.status === 'Approved' && (
                <button
                  type="button"
                  className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                >
                  <DollarSign className="w-3 h-3 mr-1" />
                  Pay
                </button>
              )}
            </div>
          )
        },
      },
    ],
    []
  )

  return (
    <ContentShell className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Affiliates Management</h1>
          <p className="text-sm sm:text-base text-slate-400">
            Manage affiliate schemes, codes, and commission tracking
          </p>
        </div>
        <div className="w-full sm:w-auto">
          {canCreate && (
            <button
              type="button"
              onClick={() => setSchemeModal('create')}
              className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm sm:text-base w-full sm:w-auto justify-center sm:justify-start"
            >
              <Plus className="w-4 h-4" />
              <span>Create Scheme</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap flex-shrink-0 ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Icon className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative flex-1 w-full sm:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-10 pr-10 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Data table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64 p-4 rounded-lg border border-border bg-surface">
          <p className="text-sm text-text-muted">Loading affiliates data...</p>
        </div>
      ) : activeTab === 'schemes' ? (
        <DataTable
          data={filteredLayers}
          columns={schemeColumns}
          bordered
          onRowClick={canEdit ? openEdit : undefined}
          className="space-y-0"
        />
      ) : activeTab === 'affiliates' ? (
        <DataTable
          data={filteredUsers}
          columns={affiliateColumns}
          bordered
          className="space-y-0"
        />
      ) : activeTab === 'referrals' ? (
        <DataTable
          data={PLACEHOLDER_REFERRALS}
          columns={referralColumns}
          bordered
          className="space-y-0"
        />
      ) : (
        <DataTable
          data={PLACEHOLDER_COMMISSIONS}
          columns={commissionColumns}
          bordered
          className="space-y-0"
        />
      )}

      {/* Modals */}
      {schemeModal === 'create' && (
        <CreateEditSchemeModal onClose={() => setSchemeModal(null)} />
      )}
      {editingLayer && (
        <CreateEditSchemeModal
          layer={editingLayer}
          onClose={() => setEditingLayer(null)}
        />
      )}
      {viewingScheme && (
        <SchemeDetailsModal layer={viewingScheme} onClose={() => setViewingScheme(null)} />
      )}
      {deleteScheme && (
        <DeleteSchemeModal layer={deleteScheme} onClose={() => setDeleteScheme(null)} />
      )}
      {viewingAffiliate && (
        <AffiliateDetailsModal user={viewingAffiliate} onClose={() => setViewingAffiliate(null)} />
      )}
      {deleteAffiliate && (
        <DeleteAffiliateModal user={deleteAffiliate} onClose={() => setDeleteAffiliate(null)} />
      )}
    </ContentShell>
  )
}
