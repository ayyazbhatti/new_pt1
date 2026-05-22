import { useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useSessionTemplatesList } from '../hooks/useSessionTemplates'
import type { SessionDefaultMarket } from '../types/sessionTemplate'
import { cn } from '@/shared/utils'
import { useCanAccess } from '@/shared/utils/permissions'

const AUTO_VALUE = '__session_template_auto__'

export interface SessionTemplateSelectProps {
  value: string | null
  onChange: (next: string | null) => void
  /** Used to label "Auto" and highlight the seeded default template for this market. */
  marketHint?: SessionDefaultMarket | string | null
  disabled?: boolean
}

export function SessionTemplateSelect({ value, onChange, marketHint, disabled }: SessionTemplateSelectProps) {
  const canList = useCanAccess('sessions:view')
  const { data: templates = [], isLoading } = useSessionTemplatesList({ enabled: canList })

  const defaultTemplateId = useMemo(() => {
    if (!marketHint) return undefined
    const t = templates.find((x) => x.isDefaultForMarket === marketHint)
    return t?.id
  }, [templates, marketHint])

  const selectValue = value ?? AUTO_VALUE

  const autoLabel =
    marketHint != null && marketHint !== ''
      ? `Auto (default for ${String(marketHint)})`
      : 'Auto (default for market)'

  return (
    <div className="space-y-2">
      {!canList ? (
        <p className="text-sm text-muted">Assign the sessions:view permission to load session templates for this dropdown.</p>
      ) : null}
      <Select
        value={selectValue}
        onValueChange={(v) => onChange(v === AUTO_VALUE ? null : v)}
        disabled={disabled || isLoading || !canList}
      >
        <SelectTrigger>
          <SelectValue placeholder={isLoading ? 'Loading…' : 'Select template'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_VALUE}>{autoLabel}</SelectItem>
          {templates.map((t) => {
            const isDefaultForHint = defaultTemplateId != null && t.id === defaultTemplateId
            return (
              <SelectItem
                key={t.id}
                value={t.id}
                className={cn(isDefaultForHint && 'bg-surface-2 font-medium')}
              >
                {t.name}
                {isDefaultForHint ? ' (default)' : ''}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted">Override the default session template for this symbol&apos;s market, or leave on Auto.</p>
    </div>
  )
}
