import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { toast } from '@/shared/components/common'
import type { PromotionSlide } from '../types/promotions'
import type { CreateSlidePayload, UpdateSlidePayload } from '../types/promotions'

function isValidUrl(s: string): boolean {
  if (!s.trim()) return true
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

interface CreateEditPromoSlideModalProps {
  slide?: PromotionSlide | null
  onSave: (payload: CreateSlidePayload | UpdateSlidePayload) => void | Promise<void>
  isEdit?: boolean
}

export function CreateEditPromoSlideModal({ slide, onSave, isEdit }: CreateEditPromoSlideModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [imageUrl, setImageUrl] = useState(slide?.imageUrl ?? '')
  const [title, setTitle] = useState(slide?.title ?? '')
  const [subtitle, setSubtitle] = useState(slide?.subtitle ?? '')
  const [linkUrl, setLinkUrl] = useState(slide?.linkUrl ?? '')
  const [linkLabel, setLinkLabel] = useState(slide?.linkLabel ?? '')
  const [isActive, setIsActive] = useState(slide?.isActive ?? true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (slide) {
      setImageUrl(slide.imageUrl)
      setTitle(slide.title)
      setSubtitle(slide.subtitle ?? '')
      setLinkUrl(slide.linkUrl ?? '')
      setLinkLabel(slide.linkLabel ?? '')
      setIsActive(slide.isActive ?? true)
    }
  }, [slide])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedImage = imageUrl.trim()
    const trimmedTitle = title.trim()
    if (!trimmedImage) {
      toast.error('Image URL is required.')
      return
    }
    if (!trimmedTitle) {
      toast.error('Title is required.')
      return
    }
    if (!isValidUrl(trimmedImage)) {
      toast.error('Image URL must be a valid URL.')
      return
    }
    if (linkUrl.trim() && !isValidUrl(linkUrl.trim())) {
      toast.error('Link URL must be a valid URL.')
      return
    }
    setIsSubmitting(true)
    try {
      if (isEdit && slide) {
        await onSave({
          image_url: trimmedImage,
          title: trimmedTitle,
          subtitle: subtitle.trim() || null,
          link_url: linkUrl.trim() || null,
          link_label: linkLabel.trim() || null,
          is_active: isActive,
        })
        closeModal(`edit-promo-${slide.id}`)
      } else {
        await onSave({
          image_url: trimmedImage,
          title: trimmedTitle,
          subtitle: subtitle.trim() || null,
          link_url: linkUrl.trim() || null,
          link_label: linkLabel.trim() || null,
          is_active: isActive,
        })
        closeModal('create-promo')
      }
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="promo-image-url">Image URL *</Label>
        <Input
          id="promo-image-url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="promo-title">Title *</Label>
        <Input
          id="promo-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Premium Analytics"
          maxLength={255}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="promo-subtitle">Subtitle</Label>
        <Input
          id="promo-subtitle"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Optional subtext"
          maxLength={500}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="promo-link-url">Link URL</Label>
        <Input
          id="promo-link-url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://..."
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="promo-link-label">Link label</Label>
        <Input
          id="promo-link-label"
          value={linkLabel}
          onChange={(e) => setLinkLabel(e.target.value)}
          placeholder="e.g. Learn more"
          maxLength={100}
          className="mt-1"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="promo-active"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="rounded border-border"
        />
        <Label htmlFor="promo-active">Active (visible in terminal)</Label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeModal(isEdit && slide ? `edit-promo-${slide.id}` : 'create-promo')}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  )
}
