import { useCallback } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { useModalStore } from '@/app/store'
import { useCanAccess } from '@/shared/utils/permissions'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listPromotionSlides,
  createPromotionSlide,
  updatePromotionSlide,
  deletePromotionSlide,
  reorderPromotionSlides,
  togglePromotionSlide,
} from '../api/promotions.api'
import type { PromotionSlide, CreateSlidePayload, UpdateSlidePayload } from '../types/promotions'
import { CreateEditPromoSlideModal } from '../modals/CreateEditPromoSlideModal'
import { DeletePromoSlideModal } from '../modals/DeletePromoSlideModal'
import { Button } from '@/shared/ui/button'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { cn } from '@/shared/utils'

const PROMO_QUERY_KEY = ['admin', 'promotions', 'slides'] as const

export function AdminPromotionsPage() {
  const queryClient = useQueryClient()
  const openModal = useModalStore((state) => state.openModal)
  const canView = useCanAccess('promotions:view')
  const canEdit = useCanAccess('promotions:edit')

  const { data: slides = [], isLoading, error } = useQuery({
    queryKey: PROMO_QUERY_KEY,
    queryFn: listPromotionSlides,
    enabled: canView,
  })

  const createMutation = useMutation({
    mutationFn: (payload: CreateSlidePayload) => createPromotionSlide(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY })
      useModalStore.getState().closeModal('create-promo')
      toast.success('Slide created.')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (err as Error)?.message
      toast.error(msg ?? 'Failed to create slide')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSlidePayload }) =>
      updatePromotionSlide(id, payload),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY })
      useModalStore.getState().closeModal(`edit-promo-${id}`)
      toast.success('Slide updated.')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (err as Error)?.message
      toast.error(msg ?? 'Failed to update slide')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePromotionSlide(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY })
      useModalStore.getState().closeModal(`delete-promo-${id}`)
      toast.success('Slide deleted.')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (err as Error)?.message
      toast.error(msg ?? 'Failed to delete slide')
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => reorderPromotionSlides({ order }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY })
      toast.success('Order updated.')
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message ?? 'Failed to reorder'
      toast.error(msg)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      togglePromotionSlide(id, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROMO_QUERY_KEY })
      toast.success('Slide updated.')
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message ?? 'Failed to update'
      toast.error(msg)
    },
  })

  const handleAddSlide = useCallback(() => {
    openModal(
      'create-promo',
      (
        <CreateEditPromoSlideModal
          onSave={(payload) => createMutation.mutate(payload as CreateSlidePayload)}
        />
      ),
      { title: 'Add slide', description: 'New promotion slide for the terminal.', size: 'md' }
    )
  }, [openModal, createMutation])

  const handleEdit = useCallback(
    (slide: PromotionSlide) => {
      openModal(
        `edit-promo-${slide.id}`,
        (
          <CreateEditPromoSlideModal
            slide={slide}
            isEdit
            onSave={(payload) => updateMutation.mutate({ id: slide.id, payload: payload as UpdateSlidePayload })}
          />
        ),
        { title: 'Edit slide', size: 'md' }
      )
    },
    [openModal, updateMutation]
  )

  const handleDelete = useCallback(
    (slide: PromotionSlide) => {
      openModal(
        `delete-promo-${slide.id}`,
        (
          <DeletePromoSlideModal
            slide={slide}
            onConfirm={() => deleteMutation.mutate(slide.id)}
          />
        ),
        { title: 'Delete slide', size: 'sm' }
      )
    },
    [openModal, deleteMutation]
  )

  const moveSlide = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newOrder = [...slides]
      const swap = direction === 'up' ? index - 1 : index + 1
      if (swap < 0 || swap >= newOrder.length) return
      ;[newOrder[index], newOrder[swap]] = [newOrder[swap], newOrder[index]]
      reorderMutation.mutate(newOrder.map((s) => s.id))
    },
    [slides, reorderMutation]
  )

  if (!canView) {
    return (
      <ContentShell>
        <PageHeader title="Terminal promotions" description="Slides shown in the trading terminal right panel." />
        <p className="text-sm text-text-muted">You do not have permission to view this page.</p>
      </ContentShell>
    )
  }

  if (isLoading) {
    return (
      <ContentShell>
        <PageHeader title="Terminal promotions" description="Slides shown in the trading terminal right panel." />
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-text-muted">Loading slides...</p>
        </div>
      </ContentShell>
    )
  }

  if (error) {
    return (
      <ContentShell>
        <PageHeader title="Terminal promotions" description="Slides shown in the trading terminal right panel." />
        <p className="text-sm text-danger">Failed to load slides.</p>
      </ContentShell>
    )
  }

  return (
    <ContentShell>
      <PageHeader
        title="Terminal promotion slider"
        description="Slides shown in the right panel of the trading terminal. Order and visibility are controlled here."
        actions={
          canEdit ? (
            <Button onClick={handleAddSlide}>
              <Plus className="h-4 w-4 mr-2" />
              Add slide
            </Button>
          ) : undefined
        }
      />
      {slides.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-2/40 p-8 text-center">
          <p className="text-text-muted">No slides yet. Add one to show promotions in the terminal.</p>
          {canEdit && (
            <Button className="mt-4" onClick={handleAddSlide}>
              <Plus className="h-4 w-4 mr-2" />
              Add slide
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {slides.map((slide, index) => (
            <div
              key={slide.id}
              className={cn(
                'flex items-center gap-4 rounded-lg border p-4',
                'border-border bg-surface-2/40'
              )}
            >
              {canEdit && (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveSlide(index, 'up')}
                    disabled={index === 0 || reorderMutation.isPending}
                    className="p-1 rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSlide(index, 'down')}
                    disabled={index === slides.length - 1 || reorderMutation.isPending}
                    className="p-1 rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="h-14 w-24 flex-shrink-0 rounded overflow-hidden bg-slate-800">
                <img
                  src={slide.imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="96" height="56" viewBox="0 0 96 56"%3E%3Crect fill="%23434" width="96" height="56"/%3E%3Ctext fill="%23888" x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="10"%3ENo image%3C/text%3E%3C/svg%3E'
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text truncate">{slide.title}</p>
                <p className="text-sm text-text-muted truncate">{slide.subtitle || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    slide.isActive ? 'bg-green-500/20 text-green-400' : 'bg-slate-600 text-slate-400'
                  )}
                >
                  {slide.isActive ? 'Active' : 'Inactive'}
                </span>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate({ id: slide.id, isActive: !slide.isActive })}
                      disabled={toggleMutation.isPending}
                      className="text-xs text-accent hover:underline disabled:opacity-50"
                    >
                      Toggle
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(slide)}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(slide)}
                      aria-label="Delete"
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ContentShell>
  )
}
