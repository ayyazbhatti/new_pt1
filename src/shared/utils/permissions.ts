import { useAuthStore, type User } from '@/shared/store/auth.store'

/** All permission keys (must match backend ALL_PERMISSION_KEYS). Used for permission profile editing and nav/route guards. */
export const ALL_PERMISSION_KEYS: readonly string[] = [
  'trading:view', 'trading:place_orders', 'trading:create_order', 'trading:cancel_order', 'trading:close_position', 'trading:liquidate',
  'deposits:approve', 'deposits:reject', 'finance:view', 'finance:manual_adjustment',
  'support:view', 'support:reply', 'support:new_chat',
  'call:view',
  'appointments:view', 'appointments:create', 'appointments:edit', 'appointments:delete', 'appointments:reschedule', 'appointments:cancel', 'appointments:complete', 'appointments:send_reminder',
  'users:view', 'users:edit', 'users:create', 'users:bulk_create', 'groups:view', 'groups:create', 'groups:edit', 'groups:delete', 'groups:symbol_settings', 'groups:price_profile', 'groups:tags',
  'managers:view', 'managers:create', 'managers:edit', 'managers:delete',
  'symbols:view', 'symbols:create', 'symbols:edit', 'symbols:delete', 'markup:view', 'markup:create', 'markup:edit', 'markup:delete', 'swap:view', 'swap:create', 'swap:edit', 'swap:delete',
  'leverage_profiles:view', 'leverage_profiles:create', 'leverage_profiles:edit', 'leverage_profiles:delete',
  'risk:view', 'risk:edit', 'reports:view',
  'dashboard:view', 'bonus:view', 'bonus:edit',   'affiliate:view', 'affiliate:create', 'affiliate:edit', 'affiliate:delete',
  'permissions:view', 'permissions:edit', 'system:view', 'settings:view', 'settings:edit',
] as const

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [],
  manager: [],
  agent: [],
}

function getPermissionsForRole(role: string): string[] {
  const r = role?.toLowerCase() ?? ''
  return ROLE_PERMISSIONS[r] ?? []
}

/** Admin and manager both get permissions only from their assigned profile (from API). No full-access bypass. */
export function getCurrentUserPermissions(user: User | null): string[] {
  if (!user) return []
  // Use API permissions when present (including empty array = no permissions). Only fall back to role when undefined/legacy.
  if (Array.isArray(user.permissions)) return user.permissions
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

/** Permissions used on each admin page (for display in modals). Route guard uses the first. */
export const ADMIN_PAGE_PERMISSIONS: Record<string, string[]> = {
  '/admin/users': ['users:view', 'users:create', 'users:edit', 'users:edit_group', 'users:edit_account_type', 'users:edit_margin', 'users:edit_trading_access'],
  '/admin/bulk-operations': ['users:bulk_create'],
  '/admin/tag': ['tags:view', 'tags:create', 'tags:edit', 'tags:delete'],
  '/admin/groups': ['groups:view', 'groups:create', 'groups:edit', 'groups:delete', 'groups:symbol_settings', 'groups:price_profile', 'groups:tags'],
  '/admin/manager': ['managers:view', 'managers:create', 'managers:edit', 'managers:delete'],
  '/admin/trading': ['trading:view', 'trading:create_order', 'trading:cancel_order', 'trading:close_position', 'trading:liquidate'],
  '/admin/leverage-profiles': ['leverage_profiles:view', 'leverage_profiles:create', 'leverage_profiles:edit', 'leverage_profiles:delete'],
  '/admin/symbols': ['symbols:view', 'symbols:create', 'symbols:edit', 'symbols:delete'],
  '/admin/markup': ['markup:view', 'markup:create', 'markup:edit', 'markup:delete'],
  '/admin/swap': ['swap:view', 'swap:create', 'swap:edit', 'swap:delete'],
  '/admin/transactions': ['finance:view', 'deposits:approve', 'deposits:reject', 'finance:manual_adjustment'],
  '/admin/finance': ['finance:view', 'deposits:approve', 'deposits:reject', 'finance:manual_adjustment'],
  '/admin/deposits': ['finance:view', 'deposits:approve', 'deposits:reject', 'finance:manual_adjustment'],
  '/admin/affiliate': ['affiliate:view', 'affiliate:create', 'affiliate:edit', 'affiliate:delete'],
  '/admin/support': ['support:view', 'support:reply', 'support:new_chat'],
  '/admin/call-user': ['call:view'],
  '/admin/appointments': ['appointments:view', 'appointments:create', 'appointments:edit', 'appointments:delete', 'appointments:reschedule', 'appointments:cancel', 'appointments:complete', 'appointments:send_reminder'],
  '/admin/permissions': ['permissions:view', 'permissions:edit'],
  '/admin/settings': ['settings:view', 'settings:edit'],
}

/** Required permission to enter each admin path. Admin and manager both need the permission. */
export const ADMIN_ROUTE_PERMISSIONS: Record<string, string> = {
  '/admin/dashboard': 'dashboard:view',
  '/admin/users': 'users:view',
  '/admin/bulk-operations': 'users:bulk_create',
  '/admin/groups': 'groups:view',
  '/admin/manager': 'managers:view',
  '/admin/tag': 'tags:view',
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
  '/admin/call-user': 'call:view',
  '/admin/appointments': 'appointments:view',
  '/admin/system': 'system:view',
  '/admin/settings': 'settings:view',
  '/admin/reports': 'reports:view',
}
