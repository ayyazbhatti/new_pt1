import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { LeverageProfile, LeverageTier } from '../types/leverageProfile'
import { ProfileFormDialog } from './ProfileFormDialog'
import { TierFormDialog } from './TierFormDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { useLeverageProfileTiers, useLeverageProfileSymbols, useDeleteLeverageTier, useSetProfileSymbols } from '../hooks/useLeverageProfiles'
import { Skeleton } from '@/shared/ui/loading'
import { Edit, Trash2, Plus, ArrowRight, ArrowLeft, Search } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'react-hot-toast'

interface ProfileDetailsDialogProps {
  profile: LeverageProfile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileDetailsDialog({ profile, open, onOpenChange }: ProfileDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [editingProfile, setEditingProfile] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const [editingTier, setEditingTier] = useState<LeverageTier | null>(null)
  const [creatingTier, setCreatingTier] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const [selectedUnassigned, setSelectedUnassigned] = useState<Set<string>>(new Set())
  const [selectedAssigned, setSelectedAssigned] = useState<Set<string>>(new Set())

  const { data: tiers, isLoading: tiersLoading } = useLeverageProfileTiers(profile?.id || null, open && activeTab === 'tiers')
  const { data: symbols, isLoading: symbolsLoading } = useLeverageProfileSymbols(profile?.id || null, open && activeTab === 'symbols')
  const deleteTier = useDeleteLeverageTier()
  const setSymbols = useSetProfileSymbols()

  if (!profile) return null

  const handleDeleteTier = async (tierId: string) => {
    if (!confirm('Are you sure you want to delete this tier?')) return
    try {
      await deleteTier.mutateAsync({ profileId: profile.id, tierId })
    } catch (error) {
      // Error handled by hook
    }
  }

  const handleAddSymbols = async () => {
    if (selectedUnassigned.size === 0) return
    const currentAssigned = new Set(symbols?.assigned.map((s) => s.symbolId) || [])
    selectedUnassigned.forEach((id) => currentAssigned.add(id))
    try {
      await setSymbols.mutateAsync({
        profileId: profile.id,
        payload: { symbol_ids: Array.from(currentAssigned) },
      })
      setSelectedUnassigned(new Set())
    } catch (error) {
      // Error handled by hook
    }
  }

  const handleRemoveSymbols = async () => {
    if (selectedAssigned.size === 0) return
    const currentAssigned = new Set(symbols?.assigned.map((s) => s.symbolId) || [])
    selectedAssigned.forEach((id) => currentAssigned.delete(id))
    try {
      await setSymbols.mutateAsync({
        profileId: profile.id,
        payload: { symbol_ids: Array.from(currentAssigned) },
      })
      setSelectedAssigned(new Set())
    } catch (error) {
      // Error handled by hook
    }
  }

  const filteredUnassigned = symbols?.unassigned.filter(
    (s) =>
      !symbolSearch ||
      s.symbolCode.toLowerCase().includes(symbolSearch.toLowerCase()) ||
      s.name?.toLowerCase().includes(symbolSearch.toLowerCase())
  ) || []

  const filteredAssigned = symbols?.assigned.filter(
    (s) =>
      !symbolSearch ||
      s.symbolCode.toLowerCase().includes(symbolSearch.toLowerCase()) ||
      s.name?.toLowerCase().includes(symbolSearch.toLowerCase())
  ) || []

  return (
    <>
      <ModalShell
        open={open && !editingProfile && !deletingProfile}
        onOpenChange={onOpenChange}
        title={`Profile Details — ${profile.name}`}
        description="Manage profile settings, tiers, and symbol assignments"
        size="xl"
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex border-b border-border">
            <TabsTrigger
              value="overview"
              className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="tiers"
              className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
            >
              Tiers ({tiers?.length || 0})
            </TabsTrigger>
            <TabsTrigger
              value="symbols"
              className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
            >
              Assign Symbols ({symbols?.assigned.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-text-muted mb-1">Name</div>
                <div className="text-text font-medium">{profile.name}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted mb-1">Status</div>
                <Badge variant={profile.status === 'active' ? 'success' : 'danger'}>{profile.status}</Badge>
              </div>
              <div className="col-span-2">
                <div className="text-sm text-text-muted mb-1">Description</div>
                <div className="text-text">{profile.description || 'No description'}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted mb-1">Tiers Count</div>
                <div className="text-text font-medium">{profile.tiersCount}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted mb-1">Symbols Count</div>
                <div className="text-text font-medium">{profile.symbolsCount}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted mb-1">Updated</div>
                <div className="text-text text-sm">{formatDistanceToNow(new Date(profile.updatedAt), { addSuffix: true })}</div>
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-border">
              <Button variant="primary" onClick={() => setEditingProfile(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
              <Button variant="danger" onClick={() => setDeletingProfile(true)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Profile
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="tiers" className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-sm text-text-muted">Manage leverage tiers for this profile</div>
              <Button onClick={() => setCreatingTier(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Tier
              </Button>
            </div>

            {tiersLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : tiers && tiers.length > 0 ? (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Tier</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Notional Range</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Max Leverage</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Initial Margin</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Maintenance Margin</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((tier, idx) => (
                      <tr key={tier.id} className="border-t border-border hover:bg-surface-2/50">
                        <td className="px-4 py-3 text-sm text-text font-medium">{tier.tierIndex}</td>
                        <td className="px-4 py-3 text-sm text-text">
                          {tier.notionalFrom} → {tier.notionalTo || '∞'}
                        </td>
                        <td className="px-4 py-3 text-sm text-text font-mono">{tier.maxLeverage}×</td>
                        <td className="px-4 py-3 text-sm text-text">{parseFloat(tier.initialMarginPercent).toFixed(4)}%</td>
                        <td className="px-4 py-3 text-sm text-text">{parseFloat(tier.maintenanceMarginPercent).toFixed(4)}%</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setEditingTier(tier)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteTier(tier.id)}>
                              <Trash2 className="h-4 w-4 text-danger" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-text-muted">
                <p>No tiers defined. Click "Add Tier" to create one.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="symbols" className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                <Input
                  placeholder="Search symbols..."
                  value={symbolSearch}
                  onChange={(e) => setSymbolSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 h-[400px]">
              {/* Unassigned */}
              <div className="border border-border rounded-lg flex flex-col">
                <div className="p-3 border-b border-border bg-surface-2">
                  <div className="text-sm font-medium text-text">Unassigned Symbols ({filteredUnassigned.length})</div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {symbolsLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : filteredUnassigned.length > 0 ? (
                    <div className="p-2 space-y-1">
                      {filteredUnassigned.map((symbol) => (
                        <label
                          key={symbol.symbolId}
                          className="flex items-center gap-2 p-2 hover:bg-surface-2 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedUnassigned.has(symbol.symbolId)}
                            onChange={(e) => {
                              const newSet = new Set(selectedUnassigned)
                              if (e.target.checked) {
                                newSet.add(symbol.symbolId)
                              } else {
                                newSet.delete(symbol.symbolId)
                              }
                              setSelectedUnassigned(newSet)
                            }}
                            className="rounded border-border"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-text">{symbol.symbolCode}</div>
                            <div className="text-xs text-text-muted">{symbol.name || '—'}</div>
                          </div>
                          <Badge variant="neutral" className="text-xs">
                            {symbol.assetClass}
                          </Badge>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-text-muted">No unassigned symbols</div>
                  )}
                </div>
                <div className="p-3 border-t border-border">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    onClick={handleAddSymbols}
                    disabled={selectedUnassigned.size === 0 || setSymbols.isPending}
                  >
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Add Selected ({selectedUnassigned.size})
                  </Button>
                </div>
              </div>

              {/* Assigned */}
              <div className="border border-border rounded-lg flex flex-col">
                <div className="p-3 border-b border-border bg-surface-2">
                  <div className="text-sm font-medium text-text">Assigned Symbols ({filteredAssigned.length})</div>
                  <div className="text-xs text-text-muted mt-1">Select symbols to remove</div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {symbolsLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : filteredAssigned.length > 0 ? (
                    <div className="p-2 space-y-1">
                      {filteredAssigned.map((symbol) => (
                        <label
                          key={symbol.symbolId}
                          className="flex items-center gap-2 p-2 hover:bg-surface-2 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedAssigned.has(symbol.symbolId)}
                            onChange={(e) => {
                              const newSet = new Set(selectedAssigned)
                              if (e.target.checked) {
                                newSet.add(symbol.symbolId)
                              } else {
                                newSet.delete(symbol.symbolId)
                              }
                              setSelectedAssigned(newSet)
                            }}
                            className="rounded border-border"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-text">{symbol.symbolCode}</div>
                            <div className="text-xs text-text-muted">{symbol.name || '—'}</div>
                          </div>
                          <Badge variant="neutral" className="text-xs">
                            {symbol.assetClass}
                          </Badge>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-text-muted">No assigned symbols</div>
                  )}
                </div>
                <div className="p-3 border-t border-border">
                  <Button
                    variant="danger"
                    size="sm"
                    className="w-full"
                    onClick={handleRemoveSymbols}
                    disabled={selectedAssigned.size === 0 || setSymbols.isPending}
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Remove Selected ({selectedAssigned.size})
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </ModalShell>

      {editingProfile && (
        <ProfileFormDialog
          mode="edit"
          initial={profile}
          open={editingProfile}
          onOpenChange={(open) => {
            setEditingProfile(open)
            if (!open) {
              onOpenChange(false)
            }
          }}
        />
      )}

      {deletingProfile && (
        <DeleteProfileDialog
          profile={profile}
          open={deletingProfile}
          onOpenChange={(open) => {
            setDeletingProfile(open)
            if (!open) {
              onOpenChange(false)
            }
          }}
        />
      )}

      {creatingTier && (
        <TierFormDialog
          mode="create"
          profileId={profile.id}
          open={creatingTier}
          onOpenChange={(open) => {
            setCreatingTier(open)
          }}
        />
      )}

      {editingTier && (
        <TierFormDialog
          mode="edit"
          profileId={profile.id}
          initial={editingTier}
          open={!!editingTier}
          onOpenChange={(open) => {
            if (!open) setEditingTier(null)
          }}
        />
      )}
    </>
  )
}

