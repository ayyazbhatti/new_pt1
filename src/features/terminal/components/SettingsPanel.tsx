import { useCallback } from 'react'
import { X, Settings as SettingsIcon, Palette, Bell, BarChart3, TrendingUp, ArrowLeft } from 'lucide-react'
import { useMediaQuery } from '@/shared/hooks'
import { useTerminalStore } from '../store'
import { Switch } from '@/shared/ui'
import { Label } from '@/shared/ui/label'
import { cn } from '@/shared/utils'
import { updateTerminalPreferences } from '../api/preferences.api'
import { toast } from '@/shared/components/common'

const PANEL_WIDTH_DESKTOP = 288

export function SettingsPanel() {
  const isMobile = !useMediaQuery('(min-width: 1024px)')
  const {
    settingsPanelOpen,
    setSettingsPanelOpen,
    chartShowAskPrice,
    setChartShowAskPrice,
    chartShowPositionMarker,
    setChartShowPositionMarker,
    chartShowClosedPositionMarker,
    setChartShowClosedPositionMarker,
    enableLiquidationEmail,
    setEnableLiquidationEmail,
    enableSlTpEmail,
    setEnableSlTpEmail,
  } = useTerminalStore()

  const handleChartShowAskPrice = useCallback(
    (checked: boolean) => {
      const prev = chartShowAskPrice
      setChartShowAskPrice(checked)
      const state = useTerminalStore.getState()
      updateTerminalPreferences({
        chartShowAskPrice: state.chartShowAskPrice,
        chartShowPositionMarker: state.chartShowPositionMarker,
        chartShowClosedPositionMarker: state.chartShowClosedPositionMarker,
        enableLiquidationEmail: state.enableLiquidationEmail,
        enableSlTpEmail: state.enableSlTpEmail,
      }).catch(() => {
        setChartShowAskPrice(prev)
        toast.error('Failed to save settings. Please try again.')
      })
    },
    [chartShowAskPrice, setChartShowAskPrice]
  )

  const handleChartShowPositionMarker = useCallback(
    (checked: boolean) => {
      const prev = chartShowPositionMarker
      setChartShowPositionMarker(checked)
      const state = useTerminalStore.getState()
      updateTerminalPreferences({
        chartShowAskPrice: state.chartShowAskPrice,
        chartShowPositionMarker: state.chartShowPositionMarker,
        chartShowClosedPositionMarker: state.chartShowClosedPositionMarker,
        enableLiquidationEmail: state.enableLiquidationEmail,
        enableSlTpEmail: state.enableSlTpEmail,
      }).catch(() => {
        setChartShowPositionMarker(prev)
        toast.error('Failed to save settings. Please try again.')
      })
    },
    [chartShowPositionMarker, setChartShowPositionMarker]
  )

  const handleChartShowClosedPositionMarker = useCallback(
    (checked: boolean) => {
      const prev = chartShowClosedPositionMarker
      setChartShowClosedPositionMarker(checked)
      const state = useTerminalStore.getState()
      updateTerminalPreferences({
        chartShowAskPrice: state.chartShowAskPrice,
        chartShowPositionMarker: state.chartShowPositionMarker,
        chartShowClosedPositionMarker: state.chartShowClosedPositionMarker,
        enableLiquidationEmail: state.enableLiquidationEmail,
        enableSlTpEmail: state.enableSlTpEmail,
      }).catch(() => {
        setChartShowClosedPositionMarker(prev)
        toast.error('Failed to save settings. Please try again.')
      })
    },
    [chartShowClosedPositionMarker, setChartShowClosedPositionMarker]
  )

  const handleEnableLiquidationEmail = useCallback(
    (checked: boolean) => {
      const prev = enableLiquidationEmail
      setEnableLiquidationEmail(checked)
      const state = useTerminalStore.getState()
      updateTerminalPreferences({
        chartShowAskPrice: state.chartShowAskPrice,
        chartShowPositionMarker: state.chartShowPositionMarker,
        chartShowClosedPositionMarker: state.chartShowClosedPositionMarker,
        enableLiquidationEmail: state.enableLiquidationEmail,
        enableSlTpEmail: state.enableSlTpEmail,
      }).catch(() => {
        setEnableLiquidationEmail(prev)
        toast.error('Failed to save settings. Please try again.')
      })
    },
    [enableLiquidationEmail, setEnableLiquidationEmail]
  )

  const handleEnableSlTpEmail = useCallback(
    (checked: boolean) => {
      const prev = enableSlTpEmail
      setEnableSlTpEmail(checked)
      const state = useTerminalStore.getState()
      updateTerminalPreferences({
        chartShowAskPrice: state.chartShowAskPrice,
        chartShowPositionMarker: state.chartShowPositionMarker,
        chartShowClosedPositionMarker: state.chartShowClosedPositionMarker,
        enableLiquidationEmail: state.enableLiquidationEmail,
        enableSlTpEmail: state.enableSlTpEmail,
      }).catch(() => {
        setEnableSlTpEmail(prev)
        toast.error('Failed to save settings. Please try again.')
      })
    },
    [enableSlTpEmail, setEnableSlTpEmail]
  )

  if (!settingsPanelOpen) return null

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col',
        isMobile ? 'w-full bg-background' : 'shrink-0 bg-background/95 backdrop-blur-sm border-l border-white/10 shadow-[-4px_0_24px_rgba(0,0,0,0.25)]',
        'animate-fade-in'
      )}
      style={isMobile ? undefined : { width: PANEL_WIDTH_DESKTOP }}
      role="dialog"
      aria-label={isMobile ? 'Settings page' : 'Settings panel'}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/10 bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          {isMobile ? (
            <button
              type="button"
              onClick={() => setSettingsPanelOpen(false)}
              className="shrink-0 p-2 -ml-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <SettingsIcon className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-text truncate">Settings</h2>
        </div>
        {!isMobile && (
          <button
            type="button"
            onClick={() => setSettingsPanelOpen(false)}
            className="shrink-0 p-2 rounded-lg text-text-muted hover:text-text hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
            title="Close panel"
            aria-label="Close settings panel"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content - single flowing list, no card borders */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-4 py-3 space-y-5">
          {/* Chart */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Chart
              </h3>
            </div>
            <div className="pl-5">
              <div className="flex items-center justify-between gap-3 py-2">
                <Label htmlFor="chart-show-ask" className="text-sm font-medium text-text cursor-pointer">
                  Show ask price line
                </Label>
                <Switch
                  id="chart-show-ask"
                  checked={chartShowAskPrice}
                  onCheckedChange={handleChartShowAskPrice}
                />
              </div>
              <p className="text-xs text-text-muted mt-0.5">Green dashed line and label on the chart</p>
              <div className="flex items-center justify-between gap-3 py-2 mt-1">
                <Label htmlFor="chart-show-position-marker" className="text-sm font-medium text-text cursor-pointer">
                  Show position open marker
                </Label>
                <Switch
                  id="chart-show-position-marker"
                  checked={chartShowPositionMarker}
                  onCheckedChange={handleChartShowPositionMarker}
                />
              </div>
              <p className="text-xs text-text-muted mt-0.5">Blue dot where position was opened</p>
              <div className="flex items-center justify-between gap-3 py-2 mt-1">
                <Label htmlFor="chart-show-closed-position-marker" className="text-sm font-medium text-text cursor-pointer">
                  Show closed position marker
                </Label>
                <Switch
                  id="chart-show-closed-position-marker"
                  checked={chartShowClosedPositionMarker}
                  onCheckedChange={handleChartShowClosedPositionMarker}
                />
              </div>
              <p className="text-xs text-text-muted mt-0.5">Orange dot where position was closed (position history)</p>
            </div>
          </div>

          {/* Notifications */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Bell className="h-3.5 w-3.5 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Notifications
              </h3>
            </div>
            <div className="pl-5">
              <div className="flex items-center justify-between gap-3 py-2">
                <Label htmlFor="enable-liquidation-email" className="text-sm font-medium text-text cursor-pointer">
                  Enable liquidation email
                </Label>
                <Switch
                  id="enable-liquidation-email"
                  checked={enableLiquidationEmail}
                  onCheckedChange={handleEnableLiquidationEmail}
                />
              </div>
              <p className="text-xs text-text-muted mt-0.5">Receive an email when your position is liquidated</p>
              <div className="flex items-center justify-between gap-3 py-2 mt-1">
                <Label htmlFor="enable-sltp-email" className="text-sm font-medium text-text cursor-pointer">
                  Enable SL/TP email
                </Label>
                <Switch
                  id="enable-sltp-email"
                  checked={enableSlTpEmail}
                  onCheckedChange={handleEnableSlTpEmail}
                />
              </div>
              <p className="text-xs text-text-muted mt-0.5">Receive an email when your position is closed by Stop Loss or Take Profit</p>
              <div className="space-y-1 mt-2">
                <div className="py-1.5">
                  <p className="text-sm font-medium text-text">Order fills</p>
                  <p className="text-xs text-text-muted mt-0.5">Sound & browser alerts</p>
                </div>
                <div className="py-1.5">
                  <p className="text-sm font-medium text-text">Price alerts</p>
                  <p className="text-xs text-text-muted mt-0.5">When price reaches level</p>
                </div>
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Palette className="h-3.5 w-3.5 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Appearance
              </h3>
            </div>
            <div className="space-y-1 pl-5">
              <div className="py-1.5">
                <p className="text-sm font-medium text-text">Theme</p>
                <p className="text-xs text-text-muted mt-0.5">Light / Dark mode</p>
              </div>
              <div className="py-1.5">
                <p className="text-sm font-medium text-text">Density</p>
                <p className="text-xs text-text-muted mt-0.5">Compact / Comfortable</p>
              </div>
            </div>
          </div>

          {/* Data & display */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-3.5 w-3.5 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Data & display
              </h3>
            </div>
            <div className="space-y-1 pl-5">
              <div className="py-1.5">
                <p className="text-sm font-medium text-text">Price format</p>
                <p className="text-xs text-text-muted mt-0.5">Decimals & separators</p>
              </div>
              <div className="py-1.5">
                <p className="text-sm font-medium text-text">Time zone</p>
                <p className="text-xs text-text-muted mt-0.5">Chart & order times</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-text-muted/60 pt-1">
            Options here will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  )
}
