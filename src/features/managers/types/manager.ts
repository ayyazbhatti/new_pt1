export type ManagerStatus = 'active' | 'disabled'

export interface Manager {
  id: string
  userId: string
  userName: string
  userEmail: string
  role: string
  permissionProfileId: string
  permissionProfileName: string
  /** Known: 'active' | 'disabled'; backend may send other values (e.g. suspended) */
  status: ManagerStatus | string
  createdAt: string
  lastLoginAt?: string
  notes?: string
  /** Tag IDs assigned to this manager (from list API). */
  tagIds?: string[]
  /** User who created this manager record (manager/admin/super_admin). */
  createdByUserId?: string | null
  createdByEmail?: string | null
}

/** User from users table that can be promoted to manager (for Create Manager dropdown) */
export interface UserOption {
  id: string
  name: string
  email: string
}
