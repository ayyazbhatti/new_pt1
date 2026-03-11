import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { ReactNode } from 'react'
import { cn } from '@/shared/utils'

interface ModalShellProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title?: string
  description?: string
  /** Page-related permissions shown at top of modal (e.g. users:view, users:create, users:edit) */
  pagePermissions?: string[]
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'content'
  variant?: 'default' | 'drawer'
  onClose?: () => void // Alias for onOpenChange for convenience
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-7xl',
  /** Width fits content (w-max), capped at viewport */
  content: 'w-max max-w-[min(95vw,80rem)]',
}

export function ModalShell({
  open = true,
  onOpenChange = () => {},
  onClose,
  title,
  description,
  pagePermissions,
  children,
  className,
  size = 'md',
  variant = 'default',
}: ModalShellProps) {
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && onClose) {
      onClose()
    }
    onOpenChange?.(newOpen)
  }

  const isDrawer = variant === 'drawer'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[100] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            isDrawer ? 'bg-black/50' : 'bg-black/50 backdrop-blur-sm'
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-[100] translate-x-[-50%] translate-y-[-50%] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] outline-none focus:outline-none focus:ring-0',
            isDrawer
              ? 'flex h-[95vh] sm:h-[90vh] max-h-[95vh] sm:max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-800 p-0 shadow-2xl m-2 sm:m-4'
              : cn(
                  'grid w-full max-h-[90vh] gap-4 border border-border bg-surface p-6 shadow-xl rounded-xl overflow-hidden',
                  sizeClasses[size],
                  className
                )
          )}
          aria-describedby={isDrawer ? undefined : undefined}
        >
          {isDrawer ? (
            <>
              <Dialog.Title className="sr-only">User details</Dialog.Title>
              {pagePermissions && pagePermissions.length > 0 && (
                <div className="shrink-0 rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-text-muted">
                  <span className="font-medium">Page permissions:</span>{' '}
                  {pagePermissions.join(' · ')}
                </div>
              )}
              <div className="flex flex-1 flex-col min-h-0 overflow-hidden">{children}</div>
            </>
          ) : (
            <>
              {pagePermissions && pagePermissions.length > 0 && (
                <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-text-muted">
                  <span className="font-medium">Page permissions:</span>{' '}
                  {pagePermissions.join(' · ')}
                </div>
              )}
              <div className="flex flex-col space-y-1.5">
                {title && (
                  <Dialog.Title className="text-lg font-semibold leading-none tracking-tight text-text">
                    {title}
                  </Dialog.Title>
                )}
                <Dialog.Description className={description ? 'text-sm text-text-muted' : 'sr-only'}>
                  {description || (title ? `${title} dialog` : 'Dialog')}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-surface-2 text-text hover:text-text"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </button>
              </Dialog.Close>
              <div className="flex flex-col min-h-0 overflow-y-auto max-h-[calc(90vh-8rem)]">{children}</div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

