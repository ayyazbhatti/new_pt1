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
  UserFundedProgramsPage,
} from '@/features/userPanel'
import { UserAppointmentsPage } from '@/features/appointments'
import { UserKycPage } from '@/features/kyc'

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
    path: '/user/kyc',
    element: <UserKycPage />,
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
    path: '/user/funded-program',
    element: <UserFundedProgramsPage />,
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
