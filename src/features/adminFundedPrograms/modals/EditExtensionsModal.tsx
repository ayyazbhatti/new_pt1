import { useState, useEffect } from 'react'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { Switch } from '@/shared/ui/Switch'
import { toast } from '@/shared/components/common'
export interface ExtensionItem {
  id: string
  label: string
  enabled: boolean
}

interface EditExtensionsModalProps {
  items: ExtensionItem[]
  onSave: (items: ExtensionItem[]) => void
  modalKey: string
}

export function EditExtensionsModal({ items, onSave, modalKey }: EditExtensionsModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [local, setLocal] = useState<ExtensionItem[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setLocal([...items])
  }, [items])

  const toggle = (id: string) => {
    setLocal((prev) =>
      prev.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      onSave(local)
      toast.success('Extensions updated.')
      closeModal(modalKey)
    } catch {
      // parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">Enable or disable optional features for funded programs.</p>
      <ul className="space-y-3">
        {local.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2"
          >
            <span className="text-sm text-text">{item.label}</span>
            <Switch
              checked={item.enabled}
              onCheckedChange={() => toggle(item.id)}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
