import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { UserStatus, KYCStatus } from '../types/users'
import { mockGroups } from '@/features/groups/mocks/groups.mock'

export type UserFilters = {
  search: string
  status: string
  kycStatus: string
  group: string
  country: string
  balanceMin: string
  balanceMax: string
}

interface UserFiltersBarProps {
  filters: UserFilters
  onFilterChange: (filters: UserFilters) => void
}

const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'SG', 'FR', 'IT', 'ES', 'NL']

export function UserFiltersBar({ filters, onFilterChange }: UserFiltersBarProps) {
  const handleChange = (field: keyof typeof filters, value: string) => {
    onFilterChange({ ...filters, [field]: value })
  }

  const handleClear = () => {
    onFilterChange({
      search: '',
      status: 'all',
      kycStatus: 'all',
      group: 'all',
      country: 'all',
      balanceMin: '',
      balanceMax: '',
    })
  }

  return (
    <div className="flex items-center gap-4 flex-wrap mb-6">
      <Input
        type="search"
        placeholder="Search name, email, or user ID..."
        value={filters.search}
        onChange={(e) => handleChange('search', e.target.value)}
        className="flex-1 max-w-sm"
      />
      <Select value={filters.status} onValueChange={(value) => handleChange('status', value)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.kycStatus} onValueChange={(value) => handleChange('kycStatus', value)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="KYC Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="none">Not Submitted</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="verified">Verified</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.group} onValueChange={(value) => handleChange('group', value)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Group" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          {mockGroups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.country} onValueChange={(value) => handleChange('country', value)}>
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Country" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {countries.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        placeholder="Min Balance"
        value={filters.balanceMin}
        onChange={(e) => handleChange('balanceMin', e.target.value)}
        className="w-[130px]"
      />
      <Input
        type="number"
        placeholder="Max Balance"
        value={filters.balanceMax}
        onChange={(e) => handleChange('balanceMax', e.target.value)}
        className="w-[130px]"
      />
      <Button variant="outline" size="sm" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}

