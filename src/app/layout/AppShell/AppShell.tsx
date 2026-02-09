import { ReactNode } from 'react'
import { TopBar } from './TopBar'
import { LeftSidebar } from './LeftSidebar'
import { CenterWorkspace } from './CenterWorkspace'
import { RightSidebar } from './RightSidebar'
import { BottomDock } from './BottomDock'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar />
        <CenterWorkspace>{children}</CenterWorkspace>
        <RightSidebar />
      </div>
      <BottomDock />
    </div>
  )
}

