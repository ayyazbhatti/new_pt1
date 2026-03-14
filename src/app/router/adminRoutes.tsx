import { RouteObject } from 'react-router-dom'
import { DashboardPage } from '@/features/dashboard'
import { AdminUsersPage } from '@/features/adminUsers'
import { GroupsPage } from '@/features/groups'
import { AdminTradingPage } from '@/features/adminTrading'
import { SymbolsPage } from '@/features/symbols'
import { SwapRulesPage } from '@/features/swap'
import { BonusPage } from '@/features/bonus'
import { AffiliatePage } from '@/features/affiliate'
import { PermissionsPage } from '@/features/permissions'
import { SupportPage } from '@/features/support'
import { SystemPage } from '@/features/system'
import { SettingsPage } from '@/features/settings'
import { ReportsPage } from '@/features/reports'
import { LeverageProfilesPage } from '@/features/leverageProfiles'
import { AdminMarkupPage } from '@/features/adminMarkup'
import { AdminTransactionsPage } from '@/features/admin/transactions'
import { ManagersPage } from '@/features/managers'
import { TagsPage } from '@/features/tags'
import { AdminAppointmentsPage } from '@/features/appointments'
import { AdminProfilePage } from '@/features/adminProfile'
import { AdminCallUserPage } from '@/features/adminCalls/pages/AdminCallUserPage'
import { AdminBulkOperationsPage } from '@/features/adminBulkOperations'
import { AdminPromotionsPage } from '@/features/adminPromotions'
import { AdminFundedProgramsPage, AdminFundedPlanDetailPage } from '@/features/adminFundedPrograms'
import { AdminLeadsPage, AdminLeadDetailPage } from '@/features/adminLeads'
import { AdminKycPage } from '@/features/kyc'

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
    path: '/admin/bulk-operations',
    element: <AdminBulkOperationsPage />,
  },
  {
    path: '/admin/groups',
    element: <GroupsPage />,
  },
  {
    path: '/admin/manager',
    element: <ManagersPage />,
  },
  {
    path: '/admin/trading',
    element: <AdminTradingPage />,
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
    path: '/admin/promotions',
    element: <AdminPromotionsPage />,
  },
  {
    path: '/admin/funded-programs',
    element: <AdminFundedProgramsPage />,
  },
  {
    path: '/admin/funded-programs/:planId',
    element: <AdminFundedPlanDetailPage />,
  },
  {
    path: '/admin/swap',
    element: <SwapRulesPage />,
  },
  {
    path: '/admin/transactions',
    element: <AdminTransactionsPage />,
  },
  // Legacy routes - redirect to new transactions page
  {
    path: '/admin/finance',
    element: <AdminTransactionsPage />,
  },
  {
    path: '/admin/deposits',
    element: <AdminTransactionsPage />,
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
    path: '/admin/tag',
    element: <TagsPage />,
  },
  {
    path: '/admin/appointments',
    element: <AdminAppointmentsPage />,
  },
  {
    path: '/admin/leads',
    element: <AdminLeadsPage />,
  },
  {
    path: '/admin/leads/:id',
    element: <AdminLeadDetailPage />,
  },
  {
    path: '/admin/kyc',
    element: <AdminKycPage />,
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
    path: '/admin/call-user',
    element: <AdminCallUserPage />,
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
    path: '/admin/profile',
    element: <AdminProfilePage />,
  },
  {
    path: '/admin/reports',
    element: <ReportsPage />,
  },
]

