import { RouteObject } from 'react-router-dom'
import { TerminalPage } from '@/features/terminal'
import { TradingPage } from '@/features/trading'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { AuthGuard } from '@/shared/components/guards/AuthGuard'

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <TerminalPage />
      </AuthGuard>
    ),
  },
  {
    path: '/user/trading',
    element: (
      <AuthGuard>
        <TradingPage />
      </AuthGuard>
    ),
  },
]

