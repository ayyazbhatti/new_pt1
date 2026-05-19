import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'

export interface TableRowActionItem {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}

interface TableRowActionsMenuProps {
  items: TableRowActionItem[]
  align?: 'left' | 'right'
  /** Controlled open state (keeps menu open across parent re-renders). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const MENU_MIN_WIDTH = 180
const MENU_ITEM_HEIGHT = 40
const MENU_PADDING = 8

export function TableRowActionsMenu({
  items,
  align = 'left',
  open: controlledOpen,
  onOpenChange,
}: TableRowActionsMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
  }
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateAnchor = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setAnchorRect(rect)
  }

  useLayoutEffect(() => {
    if (!open) return
    updateAnchor()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScrollOrResize = () => updateAnchor()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const runAction = (item: TableRowActionItem) => {
    if (item.disabled) return
    setOpen(false)
    item.onClick()
  }

  const menuHeight = items.length * MENU_ITEM_HEIGHT + MENU_PADDING
  const spaceBelow = anchorRect ? window.innerHeight - anchorRect.bottom : 0
  const openAbove = anchorRect
    ? spaceBelow < menuHeight && anchorRect.top > spaceBelow
    : false

  const menuStyle: React.CSSProperties | undefined = anchorRect
    ? {
        position: 'fixed',
        top: openAbove ? anchorRect.top - menuHeight - 4 : anchorRect.bottom + 4,
        left:
          align === 'right'
            ? Math.max(8, anchorRect.right - MENU_MIN_WIDTH)
            : Math.min(anchorRect.left, window.innerWidth - MENU_MIN_WIDTH - 8),
        minWidth: MENU_MIN_WIDTH,
        zIndex: 500,
      }
    : undefined

  const menuPanel =
    open && anchorRect ? (
      <div
        ref={menuRef}
        role="menu"
        className="rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation()
              runAction(item)
            }}
            className={cn(
              'w-full px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
              item.destructive ? 'text-danger' : 'text-text'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    ) : null

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="sm"
        title="Actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation()
          if (open) {
            setOpen(false)
            return
          }
          updateAnchor()
          setOpen(true)
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {menuPanel ? createPortal(menuPanel, document.body) : null}
    </>
  )
}
