export interface Tag {
  id: string
  name: string
  slug: string
  color: string
  description?: string
  /** Placeholder: number of users assigned (backend later) */
  userCount?: number
  /** Placeholder: number of managers assigned (backend later) */
  managerCount?: number
  createdAt: string
}
