import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { useModalStore } from '@/app/store'
import { nameToSlug, PRESET_COLORS } from '../utils/slug'
import { toast } from 'react-hot-toast'

const DEFAULT_COLOR = '#8b5cf6'

export interface CreateTagPayload {
  name: string
  slug: string
  color: string
  description?: string
}

interface CreateTagModalProps {
  onCreated?: (payload: CreateTagPayload) => void | Promise<void>
}

export function CreateTagModal({ onCreated }: CreateTagModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)

  useEffect(() => {
    if (!slugTouched && name.trim()) {
      setSlug(nameToSlug(name))
    }
  }, [name, slugTouched])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim().toLowerCase() || nameToSlug(trimmedName)
    if (!trimmedName) {
      toast.error('Name is required.')
      return
    }
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      toast.error('Slug must contain only lowercase letters, numbers, and hyphens.')
      return
    }
    const hexColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_COLOR
    setIsSubmitting(true)
    try {
      await onCreated?.({
        name: trimmedName,
        slug: trimmedSlug,
        color: hexColor,
        description: description.trim() || undefined,
      })
      closeModal('create-tag')
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="tag-name" className="block mb-1.5">
          Name
        </Label>
        <Input
          id="tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. VIP"
          required
        />
      </div>
      <div>
        <Label htmlFor="tag-slug" className="block mb-1.5">
          Slug
        </Label>
        <Input
          id="tag-slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true)
            setSlug(e.target.value)
          }}
          placeholder="e.g. vip"
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1">
          URL-friendly identifier. Auto-generated from name if left blank.
        </p>
      </div>
      <div>
        <Label className="block mb-1.5">Color</Label>
        <div className="flex flex-wrap gap-2 mb-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="h-8 w-8 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-accent"
              style={{
                backgroundColor: c,
                borderColor: color === c ? 'var(--color-text)' : 'transparent',
              }}
              title={c}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded border border-border bg-surface-1"
          />
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#8b5cf6"
            className="font-mono max-w-[120px]"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="tag-desc" className="block mb-1.5">
          Description (optional)
        </Label>
        <Textarea
          id="tag-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. High-value clients"
          rows={2}
          className="resize-none"
        />
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={() => closeModal('create-tag')}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create tag'}
        </Button>
      </div>
    </form>
  )
}
