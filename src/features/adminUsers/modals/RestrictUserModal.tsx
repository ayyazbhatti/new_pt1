import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { User } from '../types/users'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'

interface RestrictUserModalProps {
  user: User
}

export function RestrictUserModal({ user }: RestrictUserModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [reason, setReason] = useState('')

  const handleConfirm = () => {
    if (!reason.trim()) {
      toast.error('Please provide a reason')
      return
    }
    toast.success(`User ${user.name} restricted`)
    closeModal(`restrict-user-${user.id}`)
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text">
        Restrict user <strong>{user.name}</strong> ({user.email})?
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Reason *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="flex min-h-[100px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          placeholder="Explain the reason for restriction..."
        />
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => closeModal(`restrict-user-${user.id}`)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleConfirm}>
          Restrict User
        </Button>
      </div>
    </div>
  )
}

