import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { GroupPriceProfile } from '../types/pricing'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { mockPriceProfiles } from '../mocks/priceProfiles.mock'

interface AssignGroupProfileModalProps {
  groupProfile: GroupPriceProfile
}

export function AssignGroupProfileModal({ groupProfile }: AssignGroupProfileModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [selectedProfileId, setSelectedProfileId] = useState(groupProfile.profileId)

  const handleSave = () => {
    toast.success(`Price profile assigned to ${groupProfile.groupName}`)
    closeModal(`assign-group-${groupProfile.groupId}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Group Name</label>
        <Input value={groupProfile.groupName} disabled />
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Select Profile *</label>
        <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mockPriceProfiles
              .filter((p) => p.status === 'active')
              .map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="outline"
          onClick={() => closeModal(`assign-group-${groupProfile.groupId}`)}
        >
          Cancel
        </Button>
        <Button onClick={handleSave}>Assign Profile</Button>
      </div>
    </div>
  )
}

