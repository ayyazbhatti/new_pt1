export interface PromotionSlide {
  id: string
  sortOrder: number
  imageUrl: string
  title: string
  subtitle?: string | null
  linkUrl?: string | null
  linkLabel?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CreateSlidePayload {
  image_url: string
  title: string
  subtitle?: string | null
  link_url?: string | null
  link_label?: string | null
  is_active?: boolean
  sort_order?: number
}

export interface UpdateSlidePayload {
  image_url?: string
  title?: string
  subtitle?: string | null
  link_url?: string | null
  link_label?: string | null
  is_active?: boolean
  sort_order?: number
}

export interface ReorderPayload {
  order: string[]
}

export interface TogglePayload {
  is_active: boolean
}
