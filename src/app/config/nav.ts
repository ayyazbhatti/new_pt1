import { type LucideIcon, LayoutDashboard, Users, UserCog, Coins, DollarSign, Gift, UsersRound, KeyRound, Headphones, Settings, FileText, Layers, TrendingUp, Clock, Activity, Wallet, Receipt, Contact, BadgeCheck, Tag, ArrowDownToLine, ArrowUpFromLine, User, BarChart3, ClipboardList, CalendarDays } from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Permission required to see this nav item and access the route (e.g. dashboard:view). */
  permission?: string
  children?: NavItem[]
}

export const adminNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard, permission: 'dashboard:view' },
  { label: 'Users', path: '/admin/users', icon: Users, permission: 'users:view' },
  { label: 'Tags', path: '/admin/tag', icon: Tag, permission: 'users:view' },
  { label: 'Groups', path: '/admin/groups', icon: UserCog, permission: 'groups:view' },
  { label: 'Managers', path: '/admin/manager', icon: BadgeCheck, permission: 'users:view' },
  { label: 'Trading', path: '/admin/trading', icon: Activity, permission: 'trading:view' },
  { label: 'Leverage Profiles', path: '/admin/leverage-profiles', icon: Layers, permission: 'leverage_profiles:view' },
  { label: 'Symbols', path: '/admin/symbols', icon: Coins, permission: 'symbols:view' },
  { label: 'Price Markup', path: '/admin/markup', icon: TrendingUp, permission: 'markup:view' },
  { label: 'Swap Fees', path: '/admin/swap', icon: Clock, permission: 'swap:view' },
  { label: 'Transactions', path: '/admin/transactions', icon: Receipt, permission: 'finance:view' },
  { label: 'Bonus', path: '/admin/bonus', icon: Gift, permission: 'bonus:view' },
  { label: 'Affiliate', path: '/admin/affiliate', icon: UsersRound, permission: 'affiliate:view' },
  { label: 'Permissions', path: '/admin/permissions', icon: KeyRound, permission: 'permissions:view' },
  { label: 'Support', path: '/admin/support', icon: Headphones, permission: 'support:view' },
  { label: 'Appointments', path: '/admin/appointments', icon: CalendarDays, permission: 'dashboard:view' },
  { label: 'System', path: '/admin/system', icon: Settings, permission: 'system:view' },
  { label: 'Settings', path: '/admin/settings', icon: Settings, permission: 'settings:view' },
  { label: 'Reports', path: '/admin/reports', icon: FileText, permission: 'reports:view' },
]

/** User panel sidebar nav (/user/dashboard, etc.) – no permission filter; any authenticated user sees these */
export const userNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/user/dashboard', icon: LayoutDashboard },
  { label: 'Profile', path: '/user/profile', icon: User },
  { label: 'Positions', path: '/user/positions', icon: BarChart3 },
  { label: 'Orders', path: '/user/orders', icon: ClipboardList },
  { label: 'Appointments', path: '/user/appointments', icon: CalendarDays },
  { label: 'Affiliate', path: '/user/affiliate', icon: UsersRound },
  { label: 'Support', path: '/user/support', icon: Headphones },
  { label: 'Deposit', path: '/user/deposit', icon: ArrowDownToLine },
  { label: 'Withdraw', path: '/user/withdraw', icon: ArrowUpFromLine },
]

/** Agent app sidebar nav (e.g. /agent/leads) */
export const agentNavItems: NavItem[] = [
  {
    label: 'Leads',
    path: '/agent/leads',
    icon: Contact,
  },
]

