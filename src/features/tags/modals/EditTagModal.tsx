import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { useModalStore } from '@/app/store'
import { PRESET_COLORS } from '../utils/slug'
import type { Tag } from '../types/tag'
import { toast } from 'react-hot-toast'

export interface UpdateTagPayload {
  name: string
  slug: string
  color: string
  description?: string
}

interface EditTagModalProps {
  tag: Tag
  onSave?: (payload: UpdateTagPayload) => void | Promise<void>
}

export function EditTagModal({ tag, onSave }: EditTagModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [name, setName] = useState(tag.name)
  const [slug, setSlug] = useState(tag.slug)
  const [color, setColor] = useState(tag.color)
  const [description, setDescription] = useState(tag.description ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setName(tag.name)
    setSlug(tag.slug)
    setColor(tag.color)
    setDescription(tag.description ?? '')
  }, [tag])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim().toLowerCase()
    if (!trimmedName) {
      toast.error('Name is required.')
      return
    }
    if (!trimmedSlug) {
      toast.error('Slug is required.')
      return
    }
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) {
      toast.error('Slug must contain only lowercase letters, numbers, and hyphens.')
      return
    }
    const hexColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : tag.color
    setIsSubmitting(true)
    try {
      await onSave?.({
        name: trimmedName,
        slug: trimmedSlug,
        color: hexColor,
        description: description.trim() || undefined,
      })
      closeModal(`edit-tag-${tag.id}`)
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm flex items-center gap-2">
        <span
          className="h-4 w-4 rounded-full shrink-0"
          style={{ backgroundColor: tag.color }}
        />
        <span className="font-medium text-text">{tag.name}</span>
        <span className="text-text-muted font-mono">({tag.slug})</span>
      </div>
      <div>
        <Label htmlFor="edit-tag-name" className="block mb-1.5">
          Name
        </Label>
        <Input
          id="edit-tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. VIP"
          required
        />
      </div>
      <div>
        <Label htmlFor="edit-tag-slug" className="block mb-1.5">
          Slug
        </Label>
        <Input
          id="edit-tag-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="e.g. vip"
          className="font-mono text-sm"
          required
        />
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
        <Label htmlFor="edit-tag-desc" className="block mb-1.5">
          Description (optional)
        </Label>
        <Textarea
          id="edit-tag-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. High-value clients"
          rows={2}
          className="resize-none"
        />
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={() => closeModal(`edit-tag-${tag.id}`)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
