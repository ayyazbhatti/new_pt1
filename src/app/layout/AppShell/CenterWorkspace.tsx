import { ReactNode } from 'react'

interface CenterWorkspaceProps {
  children: ReactNode
}

export function CenterWorkspace({ children }: CenterWorkspaceProps) {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {children}
    </div>
  )
}

