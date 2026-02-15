import { useState, useEffect } from 'react'
import { ModalShell } from '@/shared/ui/modal'
import { Label } from '@/shared/ui/label'
import { Button } from '@/shared/ui/button'
import type { ChartIndicator } from '../utils/indicatorParams'
import { getIndicatorParamSchema, clampIndicatorParam } from '../utils/indicatorParams'

export interface IndicatorParamsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  indicator: ChartIndicator | null
  onSave: (name: string, params: number[]) => void
}

export function IndicatorParamsModal({ open, onOpenChange, indicator, onSave }: IndicatorParamsModalProps) {
  const [params, setParams] = useState<number[]>([])

  useEffect(() => {
    if (!indicator) return
    const schema = getIndicatorParamSchema(indicator.name)
    const defaults = schema.defaults.length > 0 ? schema.defaults : [14]
    const len = Math.max(indicator.params.length, schema.paramLabels.length || 1, defaults.length)
    const padded = Array.from({ length: len }, (_, i) => indicator.params[i] ?? defaults[i] ?? 14)
    setParams(padded)
  }, [indicator])

  if (!indicator) return null

  const schema = getIndicatorParamSchema(indicator.name)
  const labels =
    schema.paramLabels.length > 0
      ? schema.paramLabels
      : indicator.params.length > 0
        ? indicator.params.map((_, i) => `Param ${i + 1}`)
        : ['Period']
  const defaults = schema.defaults.length > 0 ? schema.defaults : [14]

  const handleSave = () => {
    const len = labels.length
    const clamped = params
      .slice(0, len)
      .map((p, i) => clampIndicatorParam(indicator.name, i, p))
    onSave(indicator.name, clamped.length > 0 ? clamped : defaults)
    onOpenChange(false)
  }

  const updateParam = (index: number, value: number) => {
    setParams((prev) => {
      const next = [...prev]
      if (index < next.length) next[index] = value
      else next.push(value)
      return next
    })
  }

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} title={`${indicator.name} parameters`} size="sm">
      <div className="space-y-4 pt-2">
        {labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">This indicator has no configurable parameters.</p>
        ) : (
          labels.map((label, i) => (
            <div key={i} className="space-y-1.5">
              <Label htmlFor={`param-${i}`} className="text-sm text-text">
                {label}
              </Label>
              <input
                id={`param-${i}`}
                type="number"
                min={0.001}
                max={999}
                step={defaults[i] !== Math.round(defaults[i]) ? 0.01 : 1}
                value={params[i] ?? defaults[i]}
                onChange={(e) => updateParam(i, Number(e.target.value))}
                className="w-full h-9 rounded-lg border border-border bg-surface-1 px-3 text-sm text-text"
              />
            </div>
          ))
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Apply
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
