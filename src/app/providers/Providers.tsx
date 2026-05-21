import { ReactNode } from 'react'
import { ToastProvider } from '@/shared/components/common'
import { AiReportsWsProvider } from '@/features/aiReports/providers/AiReportsWsProvider'
import { QueryProvider } from './QueryProvider'
import { ThemeProvider } from './ThemeProvider'
import { AppShellTimezoneProvider } from './AppShellTimezoneProvider'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AppShellTimezoneProvider>
          <ToastProvider>
            <AiReportsWsProvider>{children}</AiReportsWsProvider>
          </ToastProvider>
        </AppShellTimezoneProvider>
      </QueryProvider>
    </ThemeProvider>
  )
}

