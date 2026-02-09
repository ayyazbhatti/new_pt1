import { RouteObject } from 'react-router-dom'
import { TerminalPage } from '@/features/terminal'
import { TradingPage } from '@/features/trading'
import { LoginPage } from '@/features/auth'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <TerminalPage />,
  },
  {
    path: '/user/trading',
    element: <TradingPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
]

