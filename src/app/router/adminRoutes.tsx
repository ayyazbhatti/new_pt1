import { RouteObject } from 'react-router-dom'
import { DashboardPage } from '@/features/dashboard'
import { AdminUsersPage } from '@/features/adminUsers'
import { GroupsPage } from '@/features/groups'
import { RiskPage } from '@/features/risk'
import { AdminTradingPage } from '@/features/adminTrading'
import { SymbolsPage } from '@/features/symbols'
import { SwapRulesPage } from '@/features/swap'
import { AdminFinancePage } from '@/features/adminFinance'
import { BonusPage } from '@/features/bonus'
import { AffiliatePage } from '@/features/affiliate'
import { PermissionsPage } from '@/features/permissions'
import { SupportPage } from '@/features/support'
import { SystemPage } from '@/features/system'
import { SettingsPage } from '@/features/settings'
import { ReportsPage } from '@/features/reports'
import { LeverageProfilesPage } from '@/features/leverageProfiles'
import { AdminMarkupPage } from '@/features/adminMarkup'

export const adminRoutes: RouteObject[] = [
  {
    path: '/admin/dashboard',
    element: <DashboardPage />,
  },
  {
    path: '/admin/users',
    element: <AdminUsersPage />,
  },
  {
    path: '/admin/groups',
    element: <GroupsPage />,
  },
  {
    path: '/admin/trading',
    element: <AdminTradingPage />,
  },
  {
    path: '/admin/risk',
    element: <RiskPage />,
  },
  {
    path: '/admin/leverage-profiles',
    element: <LeverageProfilesPage />,
  },
  {
    path: '/admin/symbols',
    element: <SymbolsPage />,
  },
  {
    path: '/admin/markup',
    element: <AdminMarkupPage />,
  },
  {
    path: '/admin/swap',
    element: <SwapRulesPage />,
  },
  {
    path: '/admin/finance',
    element: <AdminFinancePage />,
  },
  {
    path: '/admin/bonus',
    element: <BonusPage />,
  },
  {
    path: '/admin/affiliate',
    element: <AffiliatePage />,
  },
  {
    path: '/admin/permissions',
    element: <PermissionsPage />,
  },
  {
    path: '/admin/support',
    element: <SupportPage />,
  },
  {
    path: '/admin/system',
    element: <SystemPage />,
  },
  {
    path: '/admin/settings',
    element: <SettingsPage />,
  },
  {
    path: '/admin/reports',
    element: <ReportsPage />,
  },
]

