import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { TiersTable } from '../components/TiersTable'
import { CreateTierModal } from './CreateTierModal'
import { EditTierModal } from './EditTierModal'
import { useModalStore } from '@/app/store'
import { LeverageProfile, LeverageTier } from '../types/leverageProfile'
import { Plus } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { Card } from '@/shared/ui/card'

interface ManageTiersModalProps {
  profile: LeverageProfile
}

export function ManageTiersModal({ profile }: ManageTiersModalProps) {
  const openModal = useModalStore((state) => state.openModal)
  const [tiers, setTiers] = useState<LeverageTier[]>(profile.tiers)

  const handleAddTier = () => {
    openModal('create-tier', <CreateTierModal existingTiers={tiers} onSave={handleSaveTier} />, {
      title: 'Add Tier',
      size: 'md',
    })
  }

  const handleSaveTier = (tierData: Omit<LeverageTier, 'id'>) => {
    const newTier: LeverageTier = {
      ...tierData,
      id: `tier-${Date.now()}`,
    }
    setTiers([...tiers, newTier].sort((a, b) => a.from - b.from))
    toast.success('Tier added successfully')
  }

  const handleEditTier = (tier: LeverageTier) => {
    openModal(`edit-tier-${tier.id}`, <EditTierModal tier={tier} existingTiers={tiers} onSave={handleUpdateTier} />, {
      title: 'Edit Tier',
      size: 'md',
    })
  }

  const handleUpdateTier = (updatedTier: LeverageTier) => {
    setTiers(
      tiers
        .map((t) => (t.id === updatedTier.id ? updatedTier : t))
        .sort((a, b) => a.from - b.from)
    )
    toast.success('Tier updated successfully')
  }

  const handleDeleteTier = (tierId: string) => {
    setTiers(tiers.filter((t) => t.id !== tierId))
    toast.success('Tier deleted')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">
            Define leverage tiers based on margin ranges. Tiers are automatically sorted by margin range.
          </p>
        </div>
        <Button onClick={handleAddTier}>
          <Plus className="h-4 w-4 mr-2" />
          Add Tier
        </Button>
      </div>

      {tiers.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-text-muted mb-4">No tiers defined yet</p>
          <Button variant="outline" onClick={handleAddTier}>
            <Plus className="h-4 w-4 mr-2" />
            Add First Tier
          </Button>
        </Card>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <TiersTable
            tiers={tiers}
            onTierDelete={handleDeleteTier}
            onTierEdit={handleEditTier}
          />
        </div>
      )}

      <div className="mt-4 p-4 bg-surface-2 rounded-lg">
        <h4 className="text-sm font-semibold text-text mb-2">Validation Rules</h4>
        <ul className="text-xs text-text-muted space-y-1 list-disc list-inside">
          <li>No overlapping ranges allowed</li>
          <li>"Margin To" must be greater than "Margin From"</li>
          <li>Leverage cannot exceed 1:1000</li>
          <li>Tiers are automatically sorted by margin range</li>
        </ul>
      </div>
    </div>
  )
}

