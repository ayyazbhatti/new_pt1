import { ReactNode } from 'react'
import { TerminalMobileNav } from '../components/TerminalMobileNav'

interface TerminalLayoutProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  /** Optional panel overlaid on top of the right column (widget-style). */
  rightPanel?: ReactNode
  /** When true, render single-column mobile layout with mobileMain + bottom nav instead of three columns. */
  isMobile?: boolean
  /** Main content for mobile (< lg): one of Chart / Trade / Positions / Account view. */
  mobileMain?: ReactNode
}

export function TerminalLayout({
  left,
  center,
  right,
  rightPanel,
  isMobile = false,
  mobileMain = null,
}: TerminalLayoutProps) {
  const hasRightPanel = rightPanel != null

  if (isMobile) {
    return (
      <div className="h-full min-h-[100dvh] w-full overflow-hidden bg-background flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden flex-shrink min-w-0">
          {mobileMain}
        </div>
        {hasRightPanel && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            {rightPanel}
          </div>
        )}
        <div className="shrink-0 flex-shrink-0">
          <TerminalMobileNav />
        </div>
      </div>
    )
  }

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
