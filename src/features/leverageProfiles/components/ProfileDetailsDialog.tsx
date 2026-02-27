import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Label } from '@/shared/ui/label'
import { LeverageProfile, LeverageTier, CreateLeverageTierPayload, UpdateLeverageTierPayload } from '../types/leverageProfile'
import { ProfileFormDialog } from './ProfileFormDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { useLeverageProfileTiers, useDeleteLeverageTier, useCreateLeverageTier, useUpdateLeverageTier } from '../hooks/useLeverageProfiles'
import { Skeleton, Spinner } from '@/shared/ui/loading'
import { Edit, Trash2, Plus, X } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { formatDistanceToNow } from 'date-fns'
import { toast } from '@/shared/components/common'

const tierFormSchema = z.object({
  tier_index: z.number().min(1, 'Tier index must be >= 1'),
  notional_from: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num >= 0
  }, 'Must be a number >= 0'),
  notional_to: z.string().optional().nullable().refine(
    (val) => {
      if (!val || val === '') return true
      const num = parseFloat(val)
      return !isNaN(num)
    },
    'Must be a valid number'
  ),
  max_leverage: z.number().min(1, 'Max leverage must be >= 1'),
  initial_margin_percent: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num >= 0
  }, 'Must be >= 0'),
  maintenance_margin_percent: z.string().refine((val) => {
    const num = parseFloat(val)
    return !isNaN(num) && num >= 0
  }, 'Must be >= 0'),
}).refine(
  (data) => {
    if (!data.notional_to || data.notional_to === '') return true
    const from = parseFloat(data.notional_from)
    const to = parseFloat(data.notional_to)
    return to > from
  },
  { message: 'Range "to" must be > "from"', path: ['notional_to'] }
)
type TierFormData = z.infer<typeof tierFormSchema>

interface ProfileDetailsDialogProps {
  profile: LeverageProfile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const defaultTierFormValues: TierFormData = {
  tier_index: 1,
  notional_from: '0',
  notional_to: '',
  max_leverage: 500,
  initial_margin_percent: '0.2',
  maintenance_margin_percent: '0.1',
}

export function ProfileDetailsDialog({ profile, open, onOpenChange }: ProfileDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState('tiers')
  const [editingProfile, setEditingProfile] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const [showTierForm, setShowTierForm] = useState(false)
  const [editingTier, setEditingTier] = useState<LeverageTier | null>(null)

  const { data: tiers, isLoading: tiersLoading } = useLeverageProfileTiers(profile?.id || null, open)
  const deleteTier = useDeleteLeverageTier()
  const createTier = useCreateLeverageTier()
  const updateTier = useUpdateLeverageTier()

  const tierForm = useForm<TierFormData>({
    resolver: zodResolver(tierFormSchema),
    defaultValues: defaultTierFormValues,
  })

  useEffect(() => {
    if (!showTierForm) return
    if (editingTier) {
      tierForm.reset({
        tier_index: editingTier.tierIndex,
        notional_from: editingTier.notionalFrom,
        notional_to: editingTier.notionalTo || '',
        max_leverage: editingTier.maxLeverage,
        initial_margin_percent: editingTier.initialMarginPercent,
        maintenance_margin_percent: editingTier.maintenanceMarginPercent,
      })
    } else {
      tierForm.reset({
        ...defaultTierFormValues,
        tier_index: (tiers?.length ?? 0) + 1,
      })
    }
  }, [showTierForm, editingTier, tiers?.length])

  const openAddTierForm = () => {
    setEditingTier(null)
    setShowTierForm(true)
  }
  const openEditTierForm = (tier: LeverageTier) => {
    setEditingTier(tier)
    setShowTierForm(true)
  }
  const closeTierForm = () => {
    setShowTierForm(false)
    setEditingTier(null)
    tierForm.reset(defaultTierFormValues)
  }

  if (!profile) return null

  const handleDeleteTier = async (tierId: string) => {
    if (!confirm('Are you sure you want to delete this tier?')) return
    try {
      await deleteTier.mutateAsync({ profileId: profile.id, tierId })
      if (editingTier?.id === tierId) closeTierForm()
    } catch (error) {
      // Error handled by hook
    }
  }

  const onTierFormSubmit = async (data: TierFormData) => {
    const payload: CreateLeverageTierPayload | UpdateLeverageTierPayload = {
      tier_index: data.tier_index,
      notional_from: data.notional_from,
      notional_to: data.notional_to && data.notional_to !== '' ? data.notional_to : null,
      max_leverage: data.max_leverage,
      initial_margin_percent: data.initial_margin_percent,
      maintenance_margin_percent: data.maintenance_margin_percent,
    }
    try {
      if (editingTier) {
        await updateTier.mutateAsync({ profileId: profile.id, tierId: editingTier.id, payload })
        closeTierForm()
      } else {
        await createTier.mutateAsync({ profileId: profile.id, payload: payload as CreateLeverageTierPayload })
        tierForm.reset({ ...defaultTierFormValues, tier_index: (tiers?.length ?? 0) + 1 })
        // Keep form open for "add another"
      }
    } catch (error) {
      // Error handled by mutation hook
    }
  }

  return (
    <>
      <ModalShell
        open={open && !editingProfile && !deletingProfile}
        onOpenChange={onOpenChange}
        title={`${profile.name} — Leverage tiers`}
        description="Define exposure ranges and max leverage per tier. Add tiers then optionally assign symbols."
        size="xl"
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="tiers">Tiers ({tiers?.length || 0})</TabsTrigger>
            <TabsTrigger value="overview">Profile</TabsTrigger>
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
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div>
                <p className="text-sm text-text-muted">
                  Set exposure (notional) range and max leverage per tier — e.g. 0–1000 → 10×, 1001–2000 → 20×.
                </p>
              </div>
              <Button onClick={openAddTierForm} disabled={showTierForm}>
                <Plus className="h-4 w-4 mr-2" />
                Add tier
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
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Exposure range</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-text-muted">Max leverage</th>
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
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEditTierForm(tier)}>
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
            ) : null}
            {tiers && tiers.length > 0 && !showTierForm && (
              <div className="flex justify-end">
                <Button variant="outline" onClick={openAddTierForm}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add another tier
                </Button>
              </div>
            )}
            {!tiersLoading && (!tiers || tiers.length === 0) && !showTierForm ? (
              <div className="text-center py-8 text-text-muted border border-dashed border-border rounded-lg">
                <p className="mb-2">No tiers yet. Add your first tier to define exposure range and leverage.</p>
                <Button variant="outline" onClick={openAddTierForm}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add first tier
                </Button>
              </div>
            ) : null}

            {showTierForm && (
              <div className="border border-border rounded-lg bg-surface-2/50 p-4 space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-text">
                    {editingTier ? 'Edit tier' : 'New tier'}
                  </h4>
                  <Button type="button" variant="ghost" size="sm" onClick={closeTierForm} title="Close">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <form onSubmit={tierForm.handleSubmit(onTierFormSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tier index</Label>
                      <Input
                        type="number"
                        {...tierForm.register('tier_index', { valueAsNumber: true })}
                        disabled={createTier.isPending || updateTier.isPending}
                        className="h-8"
                      />
                      {tierForm.formState.errors.tier_index && (
                        <p className="text-xs text-danger">{tierForm.formState.errors.tier_index.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Exposure from</Label>
                      <Input
                        {...tierForm.register('notional_from')}
                        placeholder="0"
                        disabled={createTier.isPending || updateTier.isPending}
                        className="h-8"
                      />
                      {tierForm.formState.errors.notional_from && (
                        <p className="text-xs text-danger">{tierForm.formState.errors.notional_from.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Exposure to (∞ if empty)</Label>
                      <Input
                        {...tierForm.register('notional_to')}
                        placeholder="10000"
                        disabled={createTier.isPending || updateTier.isPending}
                        className="h-8"
                      />
                      {tierForm.formState.errors.notional_to && (
                        <p className="text-xs text-danger">{tierForm.formState.errors.notional_to.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Max leverage</Label>
                      <Input
                        type="number"
                        {...tierForm.register('max_leverage', { valueAsNumber: true })}
                        disabled={createTier.isPending || updateTier.isPending}
                        className="h-8"
                      />
                      {tierForm.formState.errors.max_leverage && (
                        <p className="text-xs text-danger">{tierForm.formState.errors.max_leverage.message}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="ghost" size="sm" onClick={closeTierForm} disabled={createTier.isPending || updateTier.isPending}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={createTier.isPending || updateTier.isPending}>
                      {createTier.isPending || updateTier.isPending ? (
                        <><Spinner className="h-3.5 w-3.5 mr-2" /> Saving…</>
                      ) : editingTier ? (
                        'Save changes'
                      ) : (
                        'Add tier'
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            )}
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

    </>
  )
}

