import { useState } from 'react'
import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { DataTable, ColumnDef } from '@/shared/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { User, UserWallet, KYCDocument, ActivityLog } from '../types/users'
import { useModalStore } from '@/app/store'
import { CreateEditUserModal } from './CreateEditUserModal'
import { ManualAdjustmentModal } from '@/features/adminFinance/modals/ManualAdjustmentModal'
import { mockUserWallets, mockKYCDocuments, mockActivityLogs } from '../mocks/users.mock'
import { formatDateTime, formatCurrency } from '../utils/formatters'
import { toast } from '@/shared/components/common'
import { Edit, X, CheckCircle } from 'lucide-react'

interface UserDetailsModalProps {
  user: User
}

export function UserDetailsModal({ user }: UserDetailsModalProps) {
  const openModal = useModalStore((state) => state.openModal)
  const closeModal = useModalStore((state) => state.closeModal)
  const [userState, setUserState] = useState(user)
  const [adminNotes, setAdminNotes] = useState('')

  const wallets = mockUserWallets[user.id] || []
  const kycDocs = mockKYCDocuments[user.id] || []
  const activityLogs = mockActivityLogs[user.id] || []

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'danger' | 'neutral'> = {
      active: 'success',
      disabled: 'neutral',
      suspended: 'danger',
    }
    return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
  }

  const getKYCBadge = (kycStatus: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
      verified: 'success',
      pending: 'warning',
      rejected: 'danger',
      none: 'neutral',
    }
    const labels: Record<string, string> = {
      none: 'Not Submitted',
      pending: 'Pending',
      verified: 'Verified',
      rejected: 'Rejected',
    }
    return <Badge variant={variants[kycStatus] || 'neutral'}>{labels[kycStatus] || kycStatus}</Badge>
  }

  const handleAdjustWallet = (wallet: UserWallet) => {
    // Convert UserWallet to Wallet format for the modal
    const financeWallet = {
      id: wallet.id,
      userId: user.id,
      userEmail: user.email,
      walletType: wallet.walletType as 'spot' | 'margin' | 'funding',
      currency: wallet.currency as 'USD' | 'EUR' | 'BTC' | 'USDT',
      available: wallet.available,
      locked: wallet.locked,
      equity: wallet.equity,
      updatedAt: new Date().toISOString(),
    }
    openModal(`adjust-wallet-${wallet.id}`, <ManualAdjustmentModal wallet={financeWallet} />, {
      title: 'Adjust Wallet Balance',
      size: 'md',
    })
  }

  const handleApproveDoc = (doc: KYCDocument) => {
    toast.success(`Document ${doc.name} approved`)
  }

  const handleRejectDoc = (doc: KYCDocument) => {
    toast.success(`Document ${doc.name} rejected`)
  }

  const handleSaveRestrictions = () => {
    toast.success('Restrictions saved')
  }

  const walletColumns: ColumnDef<UserWallet>[] = [
    {
      accessorKey: 'walletType',
      header: 'Wallet Type',
      cell: ({ row }) => <span className="capitalize">{row.getValue('walletType')}</span>,
    },
    {
      accessorKey: 'currency',
      header: 'Currency',
      cell: ({ row }) => <span className="font-mono">{row.getValue('currency')}</span>,
    },
    {
      accessorKey: 'available',
      header: 'Available',
      cell: ({ row }) => {
        const wallet = row.original
        return <span className="font-mono">{formatCurrency(wallet.available, wallet.currency)}</span>
      },
    },
    {
      accessorKey: 'locked',
      header: 'Locked',
      cell: ({ row }) => {
        const wallet = row.original
        return <span className="font-mono text-text-muted">{formatCurrency(wallet.locked, wallet.currency)}</span>
      },
    },
    {
      accessorKey: 'equity',
      header: 'Equity',
      cell: ({ row }) => {
        const wallet = row.original
        return <span className="font-mono">{formatCurrency(wallet.equity, wallet.currency)}</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => handleAdjustWallet(row.original)}>
          Adjust
        </Button>
      ),
    },
  ]

  const kycColumns: ColumnDef<KYCDocument>[] = [
    {
      accessorKey: 'type',
      header: 'Document Type',
      cell: ({ row }) => {
        const type = row.getValue('type') as string
        const labels: Record<string, string> = {
          id: 'ID Document',
          address: 'Proof of Address',
          selfie: 'Selfie',
        }
        return <span>{labels[type] || type}</span>
      },
    },
    {
      accessorKey: 'name',
      header: 'File Name',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        const variants: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
          approved: 'success',
          pending: 'warning',
          rejected: 'danger',
        }
        return <Badge variant={variants[status] || 'neutral'}>{status}</Badge>
      },
    },
    {
      accessorKey: 'uploadedAt',
      header: 'Uploaded',
      cell: ({ row }) => formatDateTime(row.getValue('uploadedAt')),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const doc = row.original
        if (doc.status === 'pending') {
          return (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleApproveDoc(doc)}
                className="text-success"
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRejectDoc(doc)}
                className="text-danger"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )
        }
        return <span className="text-text-muted">—</span>
      },
    },
  ]

  const activityColumns: ColumnDef<ActivityLog>[] = [
    {
      accessorKey: 'time',
      header: 'Time',
      cell: ({ row }) => formatDateTime(row.getValue('time')),
    },
    {
      accessorKey: 'action',
      header: 'Action',
    },
    {
      accessorKey: 'admin',
      header: 'Admin',
    },
    {
      accessorKey: 'details',
      header: 'Details',
    },
  ]

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-surface-2">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-lg font-semibold text-text">{userState.name}</div>
            <div className="text-sm text-text-muted">{userState.email}</div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(userState.status)}
            <Badge variant="neutral">{userState.groupName}</Badge>
          </div>
        </div>
        <div className="text-xs text-text-muted font-mono">User ID: {userState.id}</div>
      </Card>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
          <TabsTrigger value="trading">Trading</TabsTrigger>
          <TabsTrigger value="kyc">KYC</TabsTrigger>
          <TabsTrigger value="risk">Risk & Restrictions</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card className="p-4 bg-surface-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-text-muted mb-1">Full Name</div>
                <div className="text-sm text-text">{userState.name}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Email</div>
                <div className="text-sm text-text">{userState.email}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Phone</div>
                <div className="text-sm text-text">{userState.phone || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Country</div>
                <div className="text-sm text-text">{userState.country}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Registration Date</div>
                <div className="text-sm text-text-muted">{formatDateTime(userState.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Last Login</div>
                <div className="text-sm text-text-muted">
                  {userState.lastLogin ? formatDateTime(userState.lastLogin) : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Group</div>
                <div className="text-sm text-text">{userState.groupName}</div>
              </div>
              {userState.affiliateCode && (
                <div>
                  <div className="text-xs text-text-muted mb-1">Affiliate Code</div>
                  <div className="font-mono text-sm text-text">{userState.affiliateCode}</div>
                </div>
              )}
            </div>
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  openModal(`edit-user-${user.id}`, <CreateEditUserModal user={userState} />, {
                    title: 'Edit Profile',
                    size: 'md',
                  })
                }}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="wallets">
          <Card className="p-4 bg-surface-2">
            <DataTable data={wallets} columns={walletColumns} />
          </Card>
        </TabsContent>

        <TabsContent value="trading">
          <Card className="p-4 bg-surface-2">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-xs text-text-muted mb-1">Leverage Limit</div>
                <div className="text-sm text-text">
                  1:{userState.leverageLimitMin} - 1:{userState.leverageLimitMax}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Current Exposure</div>
                <div className="font-mono text-sm text-text">
                  {formatCurrency(userState.currentExposure, 'USD')}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Open Positions</div>
                <div className="text-sm text-text">{userState.openPositions}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Orders Count</div>
                <div className="text-sm text-text">{userState.ordersCount}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Margin Level</div>
                <div className="text-sm text-text">
                  {userState.marginLevel > 0 ? userState.marginLevel.toFixed(2) + '%' : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted mb-1">Price Stream Profile</div>
                <div className="text-sm text-text">{userState.priceStreamProfile}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Change Leverage Limits
              </Button>
              <Button variant="outline" size="sm">
                Change Group
              </Button>
              <Button variant="outline" size="sm" className="text-danger">
                Force Close All Positions
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="kyc">
          <Card className="p-4 bg-surface-2">
            <div className="mb-4">
              <div className="text-sm font-semibold text-text mb-2">KYC Status</div>
              {getKYCBadge(userState.kycStatus)}
            </div>
            <div className="mb-4">
              <div className="text-sm font-semibold text-text mb-2">Uploaded Documents</div>
              <DataTable data={kycDocs} columns={kycColumns} />
            </div>
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Admin Notes</label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="flex min-h-[100px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Add notes about KYC review..."
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          <Card className="p-4 bg-surface-2">
            <div className="space-y-4">
              <div className="text-sm font-semibold text-text mb-4">Trading Controls</div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text">Trading Enabled</label>
                <Switch
                  checked={userState.tradingEnabled}
                  onCheckedChange={(checked) =>
                    setUserState({ ...userState, tradingEnabled: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text">Close Only Mode</label>
                <Switch
                  checked={userState.closeOnlyMode}
                  onCheckedChange={(checked) =>
                    setUserState({ ...userState, closeOnlyMode: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text">Withdrawals Enabled</label>
                <Switch
                  checked={userState.withdrawalsEnabled}
                  onCheckedChange={(checked) =>
                    setUserState({ ...userState, withdrawalsEnabled: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text">Deposits Enabled</label>
                <Switch
                  checked={userState.depositsEnabled}
                  onCheckedChange={(checked) =>
                    setUserState({ ...userState, depositsEnabled: checked })
                  }
                />
              </div>
              <div className="border-t border-border pt-4 mt-4">
                <div className="text-sm font-semibold text-text mb-4">Limits</div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">Max Leverage Cap</label>
                    <Input
                      type="number"
                      value={userState.maxLeverageCap}
                      onChange={(e) =>
                        setUserState({ ...userState, maxLeverageCap: parseInt(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">Max Position Size</label>
                    <Input
                      type="number"
                      value={userState.maxPositionSize}
                      onChange={(e) =>
                        setUserState({ ...userState, maxPositionSize: parseInt(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text mb-2 block">Max Daily Loss</label>
                    <Input
                      type="number"
                      value={userState.maxDailyLoss}
                      onChange={(e) =>
                        setUserState({ ...userState, maxDailyLoss: parseInt(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="pt-4">
                <Button onClick={handleSaveRestrictions}>Save Restrictions</Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card className="p-4 bg-surface-2">
            <DataTable data={activityLogs} columns={activityColumns} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

