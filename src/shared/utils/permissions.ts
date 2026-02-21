import { useAuthStore, type User } from '@/shared/store/auth.store'

export const LEAD_PERMISSIONS = {
  VIEW_ALL: 'leads:view_all',
  VIEW_ASSIGNED: 'leads:view_assigned',
  CREATE: 'leads:create',
  EDIT: 'leads:edit',
  DELETE: 'leads:delete',
  ASSIGN: 'leads:assign',
  CHANGE_STAGE: 'leads:change_stage',
  EXPORT: 'leads:export',
  SETTINGS: 'leads:settings',
  TEMPLATES: 'leads:templates',
  ASSIGNMENT: 'leads:assignment',
  IMPORT: 'leads:import',
} as const

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    LEAD_PERMISSIONS.VIEW_ALL,
    LEAD_PERMISSIONS.VIEW_ASSIGNED,
    LEAD_PERMISSIONS.CREATE,
    LEAD_PERMISSIONS.EDIT,
    LEAD_PERMISSIONS.DELETE,
    LEAD_PERMISSIONS.ASSIGN,
    LEAD_PERMISSIONS.CHANGE_STAGE,
    LEAD_PERMISSIONS.EXPORT,
    LEAD_PERMISSIONS.SETTINGS,
    LEAD_PERMISSIONS.TEMPLATES,
    LEAD_PERMISSIONS.ASSIGNMENT,
    LEAD_PERMISSIONS.IMPORT,
  ],
  manager: [
    LEAD_PERMISSIONS.VIEW_ALL,
    LEAD_PERMISSIONS.VIEW_ASSIGNED,
    LEAD_PERMISSIONS.CREATE,
    LEAD_PERMISSIONS.EDIT,
    LEAD_PERMISSIONS.ASSIGN,
    LEAD_PERMISSIONS.CHANGE_STAGE,
    LEAD_PERMISSIONS.EXPORT,
    LEAD_PERMISSIONS.TEMPLATES,
  ],
  agent: [
    LEAD_PERMISSIONS.VIEW_ASSIGNED,
    LEAD_PERMISSIONS.EDIT,
    LEAD_PERMISSIONS.CHANGE_STAGE,
  ],
}

function getPermissionsForRole(role: string): string[] {
  const r = role?.toLowerCase() ?? ''
  return ROLE_PERMISSIONS[r] ?? [LEAD_PERMISSIONS.VIEW_ASSIGNED]
}

export function getCurrentUserPermissions(user: User | null): string[] {
  if (!user) return []
  if (user.permissions && user.permissions.length > 0) {
    return user.permissions
  }
  return getPermissionsForRole(user.role)
}

export function canAccess(permissionKey: string, user: User | null): boolean {
  if (!user) return false
  const perms = getCurrentUserPermissions(user)
  return perms.includes(permissionKey)
}

export function useCanAccess(permissionKey: string): boolean {
  const user = useAuthStore((s) => s.user)
  return canAccess(permissionKey, user)
}
