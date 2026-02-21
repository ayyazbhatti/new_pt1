import { ModalShell } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { useLeadsUiStore } from '../../store/leads.ui.store'

export function MergeLeadModal() {
  const { modal, closeModal } = useLeadsUiStore()
  const open = modal.mergeLead

  return (
    <ModalShell open={open} onOpenChange={(o) => !o && closeModal('mergeLead')} title="Merge leads" size="md">
      <p className="text-sm text-text-muted">Merge functionality: select target lead and confirm. (Static UI for now.)</p>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={() => closeModal('mergeLead')}>Cancel</Button>
        <Button disabled>Merge</Button>
      </div>
    </ModalShell>
  )
}
