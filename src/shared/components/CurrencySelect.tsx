import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/shared/utils'
import { Input } from '@/shared/ui/input'

export interface CurrencySelectProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  className?: string
  /**
   * `dropdown` — button + floating panel (compact inline fields).
   * `list` — search + scrollable list in one column (no inner card; merges with modal / parent surface).
   */
  variant?: 'dropdown' | 'list'
  /** When `variant="list"`, focus the search field on mount (use in small modals only). */
  autoFocusSearch?: boolean
}

interface CurrencyOption {
  code: string
  label: string
}

export function CurrencySelect({
  value,
  onChange,
  placeholder,
  allowClear,
  disabled,
  id,
  className,
  variant = 'dropdown',
  autoFocusSearch = false,
}: CurrencySelectProps) {
  const options = useMemo(() => listSupportedCurrencies(), [])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const normalizedValue = value?.trim().toUpperCase() ?? ''

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (c) => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    )
  }, [options, search])

  const selectedLabel = useMemo(() => {
    if (!normalizedValue) return ''
    const found = options.find((c) => c.code === normalizedValue)
    return found?.label ?? normalizedValue
  }, [options, normalizedValue])

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

  /** List variant: optionally focus search when mounted (small modals only). */
  useEffect(() => {
    if (variant !== 'list' || disabled || !autoFocusSearch) return
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [variant, disabled, autoFocusSearch])

  const selectCode = (code: string) => {
    onChange(code.toUpperCase())
    setSearch('')
    if (variant === 'dropdown') {
      setOpen(false)
    }
  }

  const clearCode = () => {
    onChange('')
    setSearch('')
    if (variant === 'dropdown') {
      setOpen(false)
    }
  }

  const listboxId = id ? `${id}-currency-options` : 'currency-select-options'

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
          placeholder="Search code or name…"
          autoComplete="off"
          className="h-9 pl-9 pr-2 text-sm focus:ring-inset"
          disabled={disabled}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.preventDefault()
          }}
          aria-label="Search currencies"
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
          onClick={clearCode}
          disabled={disabled}
        >
          {placeholder ?? 'Use default'}
        </button>
      ) : null}
      {filtered.map((c) => {
        const selected = c.code === normalizedValue
        return (
          <button
            key={c.code}
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
            onClick={() => selectCode(c.code)}
            disabled={disabled}
          >
            <span className="truncate">{c.label}</span>
          </button>
        )
      })}
      {filtered.length === 0 ? (
        <div className={cn('py-6 text-center text-sm text-text-muted', listEmbed ? 'px-0' : 'px-3')}>
          No matching currencies
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

  const triggerText = normalizedValue ? selectedLabel : (placeholder ?? 'Select currency')

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

function listSupportedCurrencies(): CurrencyOption[] {
  let raw: string[]
  try {
    // @ts-expect-error Intl.supportedValuesOf is supported in modern runtimes (Node 18+, current browsers).
    raw = Intl.supportedValuesOf('currency') as string[]
  } catch {
    raw = COMMON_CURRENCIES
  }
  const known = new Set([...COMMON_CURRENCIES, 'USDT', 'USDC'])
  const merged = raw
    .filter((c) => known.has(c))
    .concat(Array.from(known).filter((c) => !raw.includes(c)))
  const uniq = Array.from(new Set(merged))
  return uniq
    .map((code) => ({ code, label: formatCurrencyLabel(code) }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

function formatCurrencyLabel(code: string): string {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'currency' })
    const name = dn.of(code)
    if (name && name !== code) return `${code} (${name})`
  } catch {
    /* fall through */
  }
  return code
}

const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'AUD',
  'CAD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RUB',
  'TRY',
  'INR',
  'PKR',
  'BDT',
  'AED',
  'SAR',
  'ZAR',
  'ILS',
  'CNY',
  'CNH',
  'HKD',
  'TWD',
  'KRW',
  'SGD',
  'MYR',
  'THB',
  'IDR',
  'PHP',
  'VND',
  'BRL',
  'MXN',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  'USDT',
  'USDC',
]
