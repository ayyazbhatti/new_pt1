import { http } from '@/shared/api/http'

export interface PromotionSlidePublic {
  id: string
  sort_order: number
  image_url: string
  title: string
  subtitle?: string | null
  link_url?: string | null
  link_label?: string | null
}

/** Fetch active promotion slides for the terminal carousel. One call on mount; no polling. */
export async function getPromotionSlides(): Promise<PromotionSlidePublic[]> {
  const response = await http<PromotionSlidePublic[] | unknown>(`/api/promotions/slides`, {
    method: 'GET',
  })
  if (Array.isArray(response)) return response
  return []
}
