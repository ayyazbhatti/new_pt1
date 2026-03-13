import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { adminNavItems } from '@/app/config'
import { useAuthStore } from '@/shared/store/auth.store'
import { canAccess } from '@/shared/utils/permissions'
import { cn } from '@/shared/utils'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, render the trigger button (for Topbar). */
  showTrigger?: boolean
}

export function CommandPalette({ open, onOpenChange, showTrigger = false }: CommandPaletteProps) {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const visibleItems = useMemo(
    () =>
      adminNavItems.filter(
        (item) =>
          (!item.permission || canAccess(item.permission, user)) &&
          (query.trim() === '' ||
            item.label.toLowerCase().includes(query.trim().toLowerCase()) ||
            item.path.toLowerCase().includes(query.trim().toLowerCase()))
      ),
    [user, query]
  )

  const select = useCallback(
    (path: string) => {
      navigate(path)
      onOpenChange(false)
      setQuery('')
      setSelectedIndex(0)
    },
    [navigate, onOpenChange]
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  useEffect(() => {
    if (!visibleItems.length) return
    if (selectedIndex >= visibleItems.length) setSelectedIndex(visibleItems.length - 1)
    if (selectedIndex < 0) setSelectedIndex(0)
  }, [visibleItems.length, selectedIndex])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const item = el.querySelector(`[data-index="${selectedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onOpenChange(!open)
        return
      }
      if (!open) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, visibleItems.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (visibleItems[selectedIndex]) select(visibleItems[selectedIndex].path)
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, visibleItems, selectedIndex, onOpenChange, select])

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className={cn(
            'flex h-9 min-w-0 flex-1 min-w-[200px] items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 text-sm text-text-muted',
            'hover:bg-surface-2 hover:text-text focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
            'sm:h-10'
          )}
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4 shrink-0 sm:left-3" />
          <span className="truncate">Search or jump to...</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
            {isMac ? '⌘' : 'Ctrl'}K
          </kbd>
        </button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="top-[20%] w-full max-w-2xl max-h-[70vh] translate-y-0 p-0 gap-0 overflow-hidden"
          showClose={true}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <div className="flex items-center border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <Input
              placeholder="Search pages..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 border-0 bg-transparent pl-2 focus-visible:ring-0 focus-visible:ring-offset-0"
              autoFocus
              aria-label="Search commands"
            />
          </div>
          <div
            ref={listRef}
            className="max-h-[min(60vh,400px)] overflow-y-auto py-2"
            role="listbox"
            aria-label="Navigation"
          >
            {visibleItems.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No pages match &quot;{query}&quot;
              </div>
            ) : (
              visibleItems.map((item, index) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.path}
                    type="button"
                    data-index={index}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => select(item.path)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                      index === selectedIndex
                        ? 'bg-accent/15 text-accent'
                        : 'text-text hover:bg-surface-2'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                    <span className="truncate">{item.label}</span>
                  </button>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
