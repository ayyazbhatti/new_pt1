export interface Tag {
  id: string
  name: string
  slug: string
  color: string
  description?: string
  userCount?: number
  managerCount?: number
  createdAt: string
  /** User who created this tag (manager/admin/super_admin) */
  createdByUserId?: string
  createdByEmail?: string
}
