import { TerminalLayout } from '../layout/TerminalLayout'
import { LeftSidebar } from '../components/LeftSidebar'
import { CenterWorkspace } from '../components/CenterWorkspace'
import { RightTradingPanel } from '../components/RightTradingPanel'

export function AppShellTerminal() {
  return (
    <TerminalLayout
      left={<LeftSidebar />}
      center={<CenterWorkspace />}
      right={<RightTradingPanel />}
    />
  )
}
