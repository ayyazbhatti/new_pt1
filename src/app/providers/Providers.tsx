import { ReactNode } from 'react'
import { ToastProvider } from '@/shared/components/common'
import { AiReportsWsProvider } from '@/features/aiReports/providers/AiReportsWsProvider'
import { QueryProvider } from './QueryProvider'
import { ThemeProvider } from './ThemeProvider'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <AiReportsWsProvider>{children}</AiReportsWsProvider>
        </ToastProvider>
      </QueryProvider>
    </ThemeProvider>
  )
}

