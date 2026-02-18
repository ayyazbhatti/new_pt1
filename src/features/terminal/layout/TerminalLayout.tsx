import { ReactNode } from 'react'

interface TerminalLayoutProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  /** Optional panel overlaid on top of the right column (widget-style). */
  rightPanel?: ReactNode
}

export function TerminalLayout({ left, center, right, rightPanel }: TerminalLayoutProps) {
  const hasRightPanel = rightPanel != null

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <div className="grid h-full w-full grid-cols-[224px_1fr_288px]">
        <div className="h-full min-h-0 overflow-hidden border-r border-white/10">{left}</div>
        <div className="h-full min-h-0 overflow-hidden flex flex-col">{center}</div>
        <div className="h-full min-h-0 overflow-hidden border-l border-white/10 relative">
          {right}
          {hasRightPanel && (
            <div className="absolute inset-y-0 right-0 z-20 flex shadow-lg">
              {rightPanel}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

