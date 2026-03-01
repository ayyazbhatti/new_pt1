import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { User } from '../types/users'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import { sendNotificationToUser } from '../api/users.api'

interface SendNotificationModalProps {
  user: User
}

export function SendNotificationModal({ user }: SendNotificationModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    const t = title.trim()
    const m = details.trim()
    if (!t || !m) {
      toast.error('Title and details are required')
      return
    }
    setSending(true)
    try {
      await sendNotificationToUser(user.id, { title: t, message: m })
      toast.success(`Notification sent to ${user.name}`)
      closeModal(`send-notify-${user.id}`)
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
        (error as Error)?.message ||
        'Failed to send notification'
      toast.error(msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Send a notification to <strong className="text-text">{user.name}</strong> ({user.email}).
        They will see it in their notification panel.
      </p>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Title *</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Notification title"
          maxLength={200}
          className="w-full"
        />
        <p className="text-xs text-text-muted mt-1">{title.length}/200</p>
      </div>
      <div>
        <label className="text-sm font-medium text-text mb-2 block">Details *</label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Message body"
          maxLength={2000}
          rows={4}
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        />
        <p className="text-xs text-text-muted mt-1">{details.length}/2000</p>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="outline"
          onClick={() => closeModal(`send-notify-${user.id}`)}
          disabled={sending}
        >
          Cancel
        </Button>
        <Button onClick={handleSend} disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
