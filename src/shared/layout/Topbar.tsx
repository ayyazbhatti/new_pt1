import { Bell, Search, User } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'

export function Topbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface-1 px-6">
      <div className="flex items-center gap-4 flex-1">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search..."
            className="pl-10"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-danger" />
        </Button>
        <Button variant="ghost" size="sm">
          <User className="h-5 w-5" />
        </Button>
      </div>
    </header>
  )
}

