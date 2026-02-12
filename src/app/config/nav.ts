import { type LucideIcon, LayoutDashboard, Users, UserCog, Shield, Coins, DollarSign, Gift, UsersRound, KeyRound, Headphones, Settings, FileText, Layers, TrendingUp, Clock, Activity, Wallet } from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  children?: NavItem[]
}

export const adminNavItems: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/admin/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Users',
    path: '/admin/users',
    icon: Users,
  },
  {
    label: 'Groups',
    path: '/admin/groups',
    icon: UserCog,
  },
  {
    label: 'Trading',
    path: '/admin/trading',
    icon: Activity,
  },
  {
    label: 'Risk',
    path: '/admin/risk',
    icon: Shield,
  },
  {
    label: 'Leverage Profiles',
    path: '/admin/leverage-profiles',
    icon: Layers,
  },
  {
    label: 'Symbols',
    path: '/admin/symbols',
    icon: Coins,
  },
  {
    label: 'Price Markup',
    path: '/admin/markup',
    icon: TrendingUp,
  },
  {
    label: 'Swap Fees',
    path: '/admin/swap',
    icon: Clock,
  },
  {
    label: 'Finance',
    path: '/admin/finance',
    icon: DollarSign,
  },
  {
    label: 'Deposits',
    path: '/admin/deposits',
    icon: Wallet,
  },
  {
    label: 'Bonus',
    path: '/admin/bonus',
    icon: Gift,
  },
  {
    label: 'Affiliate',
    path: '/admin/affiliate',
    icon: UsersRound,
  },
  {
    label: 'Permissions',
    path: '/admin/permissions',
    icon: KeyRound,
  },
  {
    label: 'Support',
    path: '/admin/support',
    icon: Headphones,
  },
  {
    label: 'System',
    path: '/admin/system',
    icon: Settings,
  },
  {
    label: 'Settings',
    path: '/admin/settings',
    icon: Settings,
  },
  {
    label: 'Reports',
    path: '/admin/reports',
    icon: FileText,
  },
]

