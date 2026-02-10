import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { Search, X } from 'lucide-react'

export function UserFilters() {
  return (
    <div className="flex items-center gap-4 mb-6">
      <div className="flex-1 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            placeholder="Search users..."
            className="pl-10"
          />
        </div>
      </div>
      <Select>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
        </SelectContent>
      </Select>
      <Select>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Roles</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="trader">Trader</SelectItem>
          <SelectItem value="manager">Manager</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm">
        <X className="h-4 w-4 mr-2" />
        Clear
      </Button>
    </div>
  )
}

