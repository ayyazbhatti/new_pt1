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

/** All permission keys (must match backend ALL_PERMISSION_KEYS). Used for admin bypass and nav/route guards. */
export const ALL_PERMISSION_KEYS: readonly string[] = [
  'leads:view_all', 'leads:view_assigned', 'leads:create', 'leads:edit', 'leads:delete',
  'leads:assign', 'leads:change_stage', 'leads:export', 'leads:settings', 'leads:templates',
  'leads:assignment', 'leads:import',
  'trading:view', 'trading:place_orders', 'deposits:approve', 'deposits:reject', 'finance:view',
  'support:view', 'support:reply',
  'users:view', 'users:edit', 'users:create', 'groups:view', 'groups:edit',
  'symbols:view', 'symbols:edit', 'markup:view', 'markup:edit', 'swap:view', 'swap:edit',
  'leverage_profiles:view', 'leverage_profiles:edit',
  'risk:view', 'risk:edit', 'reports:view',
  'dashboard:view', 'bonus:view', 'bonus:edit', 'affiliate:view', 'affiliate:edit',
  'permissions:view', 'permissions:edit', 'system:view', 'settings:view', 'settings:edit',
] as const

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
  if (user.role?.toLowerCase() === 'admin') {
    return [...ALL_PERMISSION_KEYS]
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

/** Required permission to enter each admin path. Admin always bypasses. */
export const ADMIN_ROUTE_PERMISSIONS: Record<string, string> = {
  '/admin/dashboard': 'dashboard:view',
  '/admin/users': 'users:view',
  '/admin/groups': 'groups:view',
  '/admin/trading': 'trading:view',
  '/admin/risk': 'risk:view',
  '/admin/leverage-profiles': 'leverage_profiles:view',
  '/admin/symbols': 'symbols:view',
  '/admin/markup': 'markup:view',
  '/admin/swap': 'swap:view',
  '/admin/transactions': 'finance:view',
  '/admin/finance': 'finance:view',
  '/admin/deposits': 'finance:view',
  '/admin/bonus': 'bonus:view',
  '/admin/affiliate': 'affiliate:view',
  '/admin/permissions': 'permissions:view',
  '/admin/support': 'support:view',
  '/admin/system': 'system:view',
  '/admin/settings': 'settings:view',
  '/admin/reports': 'reports:view',
}
