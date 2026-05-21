import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/shared/utils'
import { Input } from '@/shared/ui/input'

export interface TimezoneSelectProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  className?: string
  /**
   * `dropdown` — button + floating panel.
   * `list` — search + scrollable list (flush; merges with modal / parent surface).
   */
  variant?: 'dropdown' | 'list'
  /** When `variant="list"`, focus the search field on mount (small modals only). */
  autoFocusSearch?: boolean
}

interface ZoneOption {
  iana: string
  label: string
}

export function TimezoneSelect({
  value,
  onChange,
  placeholder,
  allowClear,
  disabled,
  id,
  className,
  variant = 'dropdown',
  autoFocusSearch = false,
}: TimezoneSelectProps) {
  const zones = useMemo(() => listIanaTimezones(), [])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const normalizedValue = value?.trim() ?? ''

  const filteredZones = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return zones
    return zones.filter(
      (z) => z.iana.toLowerCase().includes(q) || z.label.toLowerCase().includes(q)
    )
  }, [zones, search])

  const selectedLabel = useMemo(() => {
    if (!normalizedValue) return ''
    const found = zones.find((z) => z.iana === normalizedValue)
    return found?.label ?? normalizedValue
  }, [zones, normalizedValue])

  useEffect(() => {
    if (variant !== 'dropdown' || !open) return
    searchInputRef.current?.focus()
  }, [variant, open])

  useEffect(() => {
    if (variant !== 'dropdown' || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [variant, open])

  useEffect(() => {
    if (variant !== 'dropdown' || !open) return
    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [variant, open])

  useEffect(() => {
    if (variant !== 'list' || disabled || !autoFocusSearch) return
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [variant, disabled, autoFocusSearch])

  const selectZone = (iana: string) => {
    onChange(iana)
    setSearch('')
    if (variant === 'dropdown') {
      setOpen(false)
    }
  }

  const clearZone = () => {
    onChange('')
    setSearch('')
    if (variant === 'dropdown') {
      setOpen(false)
    }
  }

  const listboxId = id ? `${id}-timezone-options` : 'timezone-select-options'

  const renderSearchRow = (searchInputId?: string, embedList?: boolean) => (
    <div
      className={cn(
        'shrink-0 border-b py-2',
        embedList ? 'border-border/60 bg-transparent' : 'border-border bg-surface-1 p-2'
      )}
    >
      <div className={cn('relative', embedList && 'px-0')}>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          ref={searchInputRef}
          id={searchInputId}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search city, region, or IANA id…"
          autoComplete="off"
          className="h-9 pl-9 pr-2 text-sm focus:ring-inset"
          disabled={disabled}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.preventDefault()
          }}
          aria-label="Search timezones"
        />
      </div>
    </div>
  )

  const optionsList = (listEmbed?: boolean) => (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {allowClear ? (
        <button
          type="button"
          role="option"
          aria-selected={!normalizedValue}
          className={cn(
            'flex w-full cursor-pointer border-b py-2 text-left text-sm text-text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            listEmbed
              ? 'border-border/40 px-0 hover:bg-surface-2/50 focus:bg-surface-2/50'
              : 'border-border/80 px-3 hover:bg-surface-2 focus:bg-surface-2'
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearZone}
          disabled={disabled}
        >
          {placeholder ?? 'Use default'}
        </button>
      ) : null}
      {filteredZones.map((tz) => {
        const selected = tz.iana === normalizedValue
        return (
          <button
            key={tz.iana}
            type="button"
            role="option"
            aria-selected={selected}
            className={cn(
              'flex w-full cursor-pointer py-2 text-left text-sm text-text focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              listEmbed
                ? 'px-0 hover:bg-surface-2/50 focus:bg-surface-2/50'
                : 'px-3 hover:bg-surface-2 focus:bg-surface-2',
              selected && (listEmbed ? 'bg-surface-2/40' : 'bg-surface-2/80')
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectZone(tz.iana)}
            disabled={disabled}
          >
            <span className="truncate">{tz.label}</span>
          </button>
        )
      })}
      {filteredZones.length === 0 ? (
        <div className={cn('py-6 text-center text-sm text-text-muted', listEmbed ? 'px-0' : 'px-3')}>
          No matching timezones
        </div>
      ) : null}
    </div>
  )

  if (variant === 'list') {
    return (
      <div
        ref={rootRef}
        className={cn(
          'flex min-h-0 max-h-[min(22rem,55vh)] flex-col',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
      >
        {normalizedValue ? (
          <div className="shrink-0 border-b border-border/50 bg-muted/15 px-3 py-2 text-xs text-text-muted">
            Selected: <span className="font-mono text-text">{selectedLabel}</span>
          </div>
        ) : null}
        {renderSearchRow(id, true)}
        <div id={listboxId} role="listbox" className="flex min-h-0 flex-1 flex-col">
          {optionsList(true)}
        </div>
      </div>
    )
  }

  const triggerText = normalizedValue ? selectedLabel : (placeholder ?? 'Select timezone')

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => {
          if (disabled) return
          setOpen((o) => !o)
        }}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-left text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 min-w-0',
          !normalizedValue && 'text-text-muted'
        )}
      >
        <span className="truncate">{triggerText}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 opacity-50 transition-transform text-text', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-[250] mt-1 flex max-h-80 flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-md"
        >
          {renderSearchRow(undefined, false)}
          {optionsList(false)}
        </div>
      ) : null}
    </div>
  )
}

function listIanaTimezones(): ZoneOption[] {
  let raw: string[]
  try {
    // @ts-expect-error Intl.supportedValuesOf is supported in modern runtimes (Node 18+, current browsers).
    raw = Intl.supportedValuesOf('timeZone') as string[]
  } catch {
    raw = COMMON_TIMEZONES
  }
  return raw.map((iana) => ({ iana, label: formatZoneLabel(iana) })).sort((a, b) => a.label.localeCompare(b.label))
}

function formatZoneLabel(iana: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    return `${iana} (${offset.replace(/^GMT/, 'UTC')})`
  } catch {
    return iana
  }
}

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'Australia/Sydney',
]
