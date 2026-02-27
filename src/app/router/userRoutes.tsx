import { RouteObject } from 'react-router-dom'
import {
  UserDashboardPage,
  UserProfilePage,
  UserAffiliatePage,
  UserDepositPage,
  UserWithdrawPage,
  UserPositionsPage,
  UserOrdersPage,
  UserSupportPage,
} from '@/features/userPanel'
import { UserAppointmentsPage } from '@/features/appointments'

export const userRoutes: RouteObject[] = [
  {
    path: '/user/dashboard',
    element: <UserDashboardPage />,
  },
  {
    path: '/user/profile',
    element: <UserProfilePage />,
  },
  {
    path: '/user/positions',
    element: <UserPositionsPage />,
  },
  {
    path: '/user/orders',
    element: <UserOrdersPage />,
  },
  {
    path: '/user/appointments',
    element: <UserAppointmentsPage />,
  },
  {
    path: '/user/affiliate',
    element: <UserAffiliatePage />,
  },
  {
    path: '/user/support',
    element: <UserSupportPage />,
  },
  {
    path: '/user/deposit',
    element: <UserDepositPage />,
  },
  {
    path: '/user/withdraw',
    element: <UserWithdrawPage />,
  },
]
