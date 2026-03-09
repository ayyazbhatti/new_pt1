import { LineChart, BarChart3, TrendingUp, LayoutList, History } from 'lucide-react'
import { useTerminalStore } from '../store'
import { cn } from '@/shared/utils'

const TABS: { id: 'quotes' | 'chart' | 'positions' | 'trade' | 'history'; label: string; icon: typeof LineChart }[] = [
  { id: 'quotes', label: 'Quotes', icon: LineChart },
  { id: 'chart', label: 'Chart', icon: BarChart3 },
  { id: 'positions', label: 'Positions', icon: LayoutList },
  { id: 'trade', label: 'Trade', icon: TrendingUp },
  { id: 'history', label: 'History', icon: History },
]

/**
 * Bottom tab bar for mobile terminal (< lg). Only rendered when isMobile.
 * Touch targets min 44px for accessibility.
 */
export function TerminalMobileNav() {
  const { mobileTab, setMobileTab } = useTerminalStore()

  return (
    <nav
      className="lg:hidden shrink-0 flex items-center justify-around border-t border-white/10 bg-surface-2/95 backdrop-blur-sm pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 flex-shrink-0"
      role="tablist"
    >
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mobileTab === id}
          onClick={() => setMobileTab(id)}
          className={cn(
            'flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg transition-colors',
            mobileTab === id
              ? 'text-accent bg-accent/10'
              : 'text-text-muted hover:text-text hover:bg-white/5'
          )}
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        </button>
      ))}
    </nav>
  )
}
