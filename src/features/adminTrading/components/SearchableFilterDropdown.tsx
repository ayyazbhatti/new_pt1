import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '@/shared/ui/input'

export interface SearchableFilterOption {
  value: string
  label: string
}

interface SearchableFilterDropdownProps {
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: SearchableFilterOption[]
  allLabel: string
  searchPlaceholder: string
  disabled?: boolean
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SearchableFilterDropdown({
  value,
  onChange,
  options,
  allLabel,
  searchPlaceholder,
  disabled,
  className = 'w-[180px]',
  open: controlledOpen,
  onOpenChange,
}: SearchableFilterDropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
    if (!next) setSearch('')
  }

  const selectedLabel = value
    ? (options.find((o) => o.value === value)?.label ?? value)
    : allLabel

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    )
  }, [options, search])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2 text-left text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[200] mt-1 w-full rounded-lg border border-border bg-surface-1 p-2 shadow-lg">
          <span className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-8"
              autoFocus
            />
          </span>

          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${
                !value ? 'bg-surface-2 font-medium text-text' : 'text-text'
              }`}
            >
              {allLabel}
            </button>
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-sm text-text-muted">No matches</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${
                    value === option.value ? 'bg-surface-2 font-medium text-text' : 'text-text'
                  }`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
