import { useState } from 'react'
import { Menu, Plus, Bell, LineChart } from 'lucide-react'
import { cn } from '@/shared/utils'
import { useAccountSummary } from '@/features/wallet/hooks/useAccountSummary'
import { useTerminalStore } from '../store/terminalStore'
import { BottomDock } from './BottomDock'

type PositionsSubTab = 'positions' | 'orders'

/**
 * Mobile Positions tab: same structure as History tab.
 * Two sub-tabs: POSITIONS (open positions) and ORDERS (pending orders).
 * Uses BottomDock in standalone mode so all position/order logic and dialogs are reused.
 */
export function TerminalPositionsView() {
  const [subTab, setSubTab] = useState<PositionsSubTab>('positions')
  const { accountSummary } = useAccountSummary()
  const { setMobileTab, setNotificationPanelOpen, setMobileSymbolPanelOpen } = useTerminalStore()

  const unrealizedPnl = accountSummary?.unrealizedPnl ?? 0
  const pnlStr = unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      {/* Header bar: hamburger (left) | UnR Net PNL + value (center) | + and notification (right) */}
      <div className="shrink-0 border-b border-white/5 px-3 py-2.5 flex items-center justify-between gap-2 min-h-[52px]">
        <button
          type="button"
          onClick={() => setMobileTab('account')}
          className="p-2 -ml-1 rounded-lg hover:bg-white/10 text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex flex-col items-center justify-center min-w-0 flex-1">
          <span className="text-[11px] uppercase tracking-wider text-muted">UnR Net PNL</span>
          <span className={cn('text-base font-bold', unrealizedPnl >= 0 ? 'text-success' : 'text-danger')}>
            {pnlStr}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setMobileSymbolPanelOpen(true)}
            className="p-2 rounded-lg hover:bg-white/10 text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Symbol live prices"
            title="Symbol live prices"
          >
            <LineChart className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('trade')}
            className="p-2 rounded-lg hover:bg-white/10 text-text min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="New order"
          >
            <Plus className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => setNotificationPanelOpen(true)}
            className="p-2 rounded-lg hover:bg-white/10 text-text min-h-[44px] min-w-[44px] flex items-center justify-center relative"
            aria-label="Notifications"
          >
            <Bell className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Sub-tabs: POSITIONS | ORDERS */}
      <div className="shrink-0 flex border-b border-white/5">
        {(['positions', 'orders'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={cn(
              'flex-1 py-3 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px',
              subTab === tab
                ? 'text-white border-accent'
                : 'text-muted border-transparent hover:text-text'
            )}
          >
            {tab === 'positions' ? 'Positions' : 'Orders'}
          </button>
        ))}
      </div>

      {/* Content: BottomDock in standalone mode (no tab strip, only positions or orders content) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <BottomDock fullHeight standaloneTab={subTab} />
      </div>
    </div>
  )
}
