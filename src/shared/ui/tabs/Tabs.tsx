import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/shared/utils'

interface TabsProps {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
}

interface TabsListProps {
  children: React.ReactNode
  className?: string
}

interface TabsTriggerProps {
  value: string
  children: React.ReactNode
  className?: string
}

interface TabsContentProps {
  value: string
  children: React.ReactNode
  className?: string
}

export function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      className={cn('w-full', className)}
    >
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-lg bg-surface-2 p-1 text-text-muted',
        className
      )}
    >
      {children}
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface-1 data-[state=active]:text-text data-[state=active]:shadow-sm',
        className
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      value={value}
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
    >
      {children}
    </TabsPrimitive.Content>
  )
}

