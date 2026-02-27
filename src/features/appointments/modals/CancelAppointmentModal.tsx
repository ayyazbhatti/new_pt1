import { useState } from 'react'
import type { Appointment, CancelAppointmentRequest } from '../types'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'

interface CancelAppointmentModalProps {
  appointment: Appointment
  onSubmit: (id: string, payload: CancelAppointmentRequest) => void
  submitting?: boolean
}

export function CancelAppointmentModal({ appointment, onSubmit, submitting = false }: CancelAppointmentModalProps) {
  const closeModal = useModalStore((s) => s.closeModal)
  const [reason, setReason] = useState('')
  const [additional_details, setAdditionalDetails] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return
    onSubmit(appointment.id, { reason: reason.trim(), additional_details: additional_details.trim() || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Reason for cancellation *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={3}
          placeholder="Required"
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-300">Additional details (optional)</label>
        <textarea
          value={additional_details}
          onChange={(e) => setAdditionalDetails(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 pt-4">
        <Button type="button" variant="outline" onClick={() => closeModal('cancel-apt')} className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600">Back</Button>
        <Button type="submit" disabled={submitting || !reason.trim()} className="bg-red-600 hover:bg-red-700">{submitting ? 'Cancelling...' : 'Cancel appointment'}</Button>
      </div>
    </form>
  )
}
