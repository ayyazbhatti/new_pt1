import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useLeadsUiStore } from '../../store/leads.ui.store'
import { useAssignLead } from '../../hooks/useLeads'
import { mockUsers } from '../../api/leads.mock'
import { useState } from 'react'

export function AssignLeadModal() {
  const { modal, closeModal, modalLead } = useLeadsUiStore()
  const open = modal.assignLead
  const assignLead = useAssignLead()
  const [ownerUserId, setOwnerUserId] = useState(modalLead?.ownerUserId ?? mockUsers[0]?.id ?? '')

  const handleAssign = () => {
    if (!modalLead) return
    assignLead.mutate(
      { id: modalLead.id, ownerUserId },
      { onSuccess: () => closeModal('assignLead') }
    )
  }

  return (
    <ModalShell open={open} onOpenChange={(o) => !o && closeModal('assignLead')} title="Assign lead" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          Assign this lead to an agent.
        </p>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Owner</label>
          <Select value={ownerUserId} onValueChange={setOwnerUserId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {mockUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => closeModal('assignLead')}>Cancel</Button>
          <Button onClick={handleAssign} disabled={assignLead.isPending}>Assign</Button>
        </div>
      </div>
    </ModalShell>
  )
}
