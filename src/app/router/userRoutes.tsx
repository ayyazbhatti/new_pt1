import { RouteObject } from 'react-router-dom'
import {
  UserDashboardPage,
  UserProfilePage,
  UserAffiliatePage,
  UserDepositPage,
  UserWithdrawPage,
  UserPositionsPage,
  UserOrdersPage,
} from '@/features/userPanel'

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
    path: '/user/affiliate',
    element: <UserAffiliatePage />,
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
