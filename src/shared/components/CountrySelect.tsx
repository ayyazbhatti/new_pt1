import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/shared/utils'
import { Input } from '@/shared/ui/input'
import type { CountryOption } from '@/shared/utils/countries'
import { getCountryLabel } from '@/shared/utils/countries'

const TRIGGER_CLASS =
  'flex h-10 w-full items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50'

export interface CountrySelectProps {
  value: string
  onChange: (value: string) => void
  options: CountryOption[]
  placeholder?: string
  className?: string
  id?: string
}

export function CountrySelect({
  value,
  onChange,
  options,
  placeholder = 'Select country',
  className,
  id,
}: CountrySelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedOption = useMemo(() => options.find((o) => o.code === value), [options, value])

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options
    const q = searchQuery.toLowerCase().trim()
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(q) ||
        opt.code.toLowerCase().includes(q)
    )
  }, [options, searchQuery])

  useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
    setSearchQuery('')
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const panel = panelRef.current
      const trigger = triggerRef.current
      const target = e.target as Node
      if (
        panel?.contains(target) ||
        trigger?.contains(target)
      )
        return
      setOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const handleSelect = (opt: CountryOption) => {
    onChange(opt.code)
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={TRIGGER_CLASS}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn(!selectedOption && 'text-text-muted')}>
          {selectedOption ? getCountryLabel(selectedOption) : placeholder}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 opacity-50 text-text shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[200] rounded-lg border border-border bg-surface-1 text-text shadow-md overflow-hidden"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: '320px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="p-2 border-b border-border shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search country..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="h-9 pl-8 pr-3 text-sm bg-surface-2 border-border"
                />
              </div>
            </div>
            <div
              className="overflow-y-auto p-1 min-h-0 flex-1"
              role="listbox"
            >
              {filteredOptions.length === 0 ? (
                <div className="py-4 text-center text-sm text-text-muted">
                  No country found
                </div>
              ) : (
                filteredOptions.map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    role="option"
                    aria-selected={opt.code === value}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-sm py-2 px-2 text-left text-sm transition-colors',
                      opt.code === value
                        ? 'bg-accent/20 text-accent'
                        : 'text-text hover:bg-surface-2'
                    )}
                    onClick={() => handleSelect(opt)}
                  >
                    <span className="text-base leading-none shrink-0">{opt.flag}</span>
                    <span className="flex-1 truncate">{opt.name}</span>
                    <span className="text-text-muted text-xs shrink-0">({opt.code})</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
