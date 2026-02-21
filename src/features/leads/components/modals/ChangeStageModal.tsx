import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useChangeStage } from '../../hooks/useLeads'
import { useLeadStages } from '../../hooks/useLeadStages'
import { useState } from 'react'

export function ChangeStageModal() {
  const { modal, closeModal, modalLead } = useLeadsUiStore()
  const open = modal.changeStage
  const changeStage = useChangeStage()
  const { data: stages } = useLeadStages()
  const [stageId, setStageId] = useState(modalLead?.stageId ?? '')

  const handleChange = () => {
    if (!modalLead) return
    changeStage.mutate(
      { id: modalLead.id, stageId },
      { onSuccess: () => closeModal('changeStage') }
    )
  }

  return (
    <ModalShell open={open} onOpenChange={(o) => !o && closeModal('changeStage')} title="Change stage" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Stage</label>
          <Select value={stageId} onValueChange={setStageId}>
            <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
            <SelectContent>
              {(stages ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => closeModal('changeStage')}>Cancel</Button>
          <Button onClick={handleChange} disabled={changeStage.isPending}>Change</Button>
        </div>
      </div>
    </ModalShell>
  )
}
