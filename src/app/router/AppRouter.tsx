import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { routes } from './routes'
import { adminRoutes } from './adminRoutes'
import { userRoutes } from './userRoutes'
import { AppShell } from '../layout'
import { AdminLayout, UserLayout } from '@/shared/layout'
import { AuthGuard } from '@/shared/components/guards/AuthGuard'
import { AdminGuard } from '@/shared/components/guards/AdminGuard'
import { UserGuard } from '@/shared/components/guards/UserGuard'

const futureFlags = {
  v7_startTransition: true,
  v7_fetcherPersist: true,
  v7_relativeSplatPath: true,
}

const router = createBrowserRouter(
  [
    ...routes.map((route) => {
      // Auth pages and terminal page don't need AppShell (terminal has its own layout)
      if (route.path === '/login' || route.path === '/register' || route.path === '/') {
        return route
      }
      // Protected routes get AppShell wrapper
      return {
        ...route,
        element: <AppShell>{route.element}</AppShell>,
      }
    }),
    ...adminRoutes.map((route) => ({
      ...route,
      element: (
        <AuthGuard>
          <AdminGuard>
            <AdminLayout>{route.element}</AdminLayout>
          </AdminGuard>
        </AuthGuard>
      ),
    })),
    ...userRoutes.map((route) => ({
      ...route,
      element: (
        <AuthGuard>
          <UserGuard>
            <UserLayout>{route.element}</UserLayout>
          </UserGuard>
        </AuthGuard>
      ),
    })),
    {
      path: '/admin',
      element: <Navigate to="/admin/dashboard" replace />,
    },
    {
      path: '/user',
      element: <Navigate to="/user/dashboard" replace />,
    },
  ],
  {
    future: futureFlags,
  }
)

export function AppRouter() {
  return <RouterProvider router={router} future={futureFlags} />
}

