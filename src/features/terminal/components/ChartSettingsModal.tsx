import { ModalShell } from '@/shared/ui/modal'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { ChartSettings } from '../utils/chartOptions'
import { cn } from '@/shared/utils'

export interface ChartSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: ChartSettings
  onSettingsChange: (settings: ChartSettings) => void
}

const TOOLTIP_OPTIONS: { value: ChartSettings['tooltipShowRule']; label: string }[] = [
  { value: 'always', label: 'Always visible' },
  { value: 'follow_cross', label: 'Follow crosshair' },
  { value: 'none', label: 'Off' },
]

export function ChartSettingsModal({ open, onOpenChange, settings, onSettingsChange }: ChartSettingsModalProps) {
  const update = (patch: Partial<ChartSettings>) => {
    onSettingsChange({ ...settings, ...patch })
  }

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} title="Chart settings" size="sm">
      <div className="space-y-6 pt-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="chart-grid" className="text-sm font-medium text-text">
            Grid
          </Label>
          <Switch
            id="chart-grid"
            checked={settings.grid}
            onCheckedChange={(checked) => update({ grid: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="chart-crosshair" className="text-sm font-medium text-text">
            Crosshair
          </Label>
          <Switch
            id="chart-crosshair"
            checked={settings.crosshair}
            onCheckedChange={(checked) => update({ crosshair: checked })}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium text-text">Tooltip</Label>
          <Select
            value={settings.tooltipShowRule}
            onValueChange={(v) => update({ tooltipShowRule: v as ChartSettings['tooltipShowRule'] })}
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOOLTIP_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-medium text-text">Candle colors</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Up</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.candleUpColor}
                  onChange={(e) => update({ candleUpColor: e.target.value })}
                  className={cn(
                    'h-9 w-12 cursor-pointer rounded border border-border bg-surface-2 p-0.5',
                    'focus:outline-none focus:ring-2 focus:ring-accent'
                  )}
                  aria-label="Up candle color"
                />
                <input
                  type="text"
                  value={settings.candleUpColor}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^#[0-9A-Fa-f]{6}$/.test(v)) update({ candleUpColor: v || '#22c55e' })
                  }}
                  className="flex-1 h-9 rounded-lg border border-border bg-surface-1 px-2 text-xs font-mono text-text"
                  placeholder="#22c55e"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Down</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.candleDownColor}
                  onChange={(e) => update({ candleDownColor: e.target.value })}
                  className={cn(
                    'h-9 w-12 cursor-pointer rounded border border-border bg-surface-2 p-0.5',
                    'focus:outline-none focus:ring-2 focus:ring-accent'
                  )}
                  aria-label="Down candle color"
                />
                <input
                  type="text"
                  value={settings.candleDownColor}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^#[0-9A-Fa-f]{6}$/.test(v)) update({ candleDownColor: v || '#ef4444' })
                  }}
                  className="flex-1 h-9 rounded-lg border border-border bg-surface-1 px-2 text-xs font-mono text-text"
                  placeholder="#ef4444"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
