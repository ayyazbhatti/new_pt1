import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SymbolPriceOverride } from '../types/pricing'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { mockPriceProfiles } from '../mocks/priceProfiles.mock'

interface SymbolOverrideModalProps {
  override: SymbolPriceOverride
}

export function SymbolOverrideModal({ override }: SymbolOverrideModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    override.overrideProfileId || 'none'
  )

  const handleSave = () => {
    if (selectedProfileId === 'none') {
      toast.success(`Override removed for ${override.symbol}`)
    } else {
      toast.success(`Price profile override set for ${override.symbol}`)
    }
    closeModal(`symbol-override-${override.symbol}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Symbol</label>
        <Input value={override.symbol} disabled />
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Default Group Profile</label>
        <Input value={override.defaultGroupProfileName} disabled />
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Override Profile</label>
        <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (Use Group Profile)</SelectItem>
            {mockPriceProfiles
              .filter((p) => p.status === 'active')
              .map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="mt-2 text-xs text-text-muted">
          If set, this symbol will use the override profile instead of the group profile.
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="outline"
          onClick={() => closeModal(`symbol-override-${override.symbol}`)}
        >
          Cancel
        </Button>
        <Button onClick={handleSave}>Save Override</Button>
      </div>
    </div>
  )
}

