import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from './routes'
import { AppShell } from '../layout'

const futureFlags = {
  v7_startTransition: true,
  v7_fetcherPersist: true,
  v7_relativeSplatPath: true,
}

const router = createBrowserRouter(
  routes.map((route) => {
    if (route.path === '/login' || route.path === '/') {
      return route
    }
    return {
      ...route,
      element: <AppShell>{route.element}</AppShell>,
    }
  }),
  {
    future: futureFlags,
  }
)

export function AppRouter() {
  return <RouterProvider router={router} future={futureFlags} />
}

