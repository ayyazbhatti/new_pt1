import { useState, useEffect, useCallback } from 'react'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Button } from '@/shared/ui/button'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { fetchAdminSymbols, fetchAdminGroups, searchAdminUsers } from '../api/lookups'
import { useDebouncedCallback } from '@/shared/hooks/useDebounce'
import { X } from 'lucide-react'

export function TradingFiltersBar() {
  const { filters, setFilters, clearFilters, symbols, groups, setSymbols, setGroups, setUsers } =
    useAdminTradingStore()
  const [userSearch, setUserSearch] = useState('')
  const [userSearchResults, setUserSearchResults] = useState<Array<{ id: string; label: string }>>([])
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(filters.userId)

  // Load symbols and groups on mount
  useEffect(() => {
    fetchAdminSymbols()
      .then((data) => {
        setSymbols(Array.isArray(data) ? data : [])
      })
      .catch((error) => {
        console.error('Failed to fetch symbols:', error)
        setSymbols([])
      })
    
    fetchAdminGroups()
      .then((data) => {
        setGroups(Array.isArray(data) ? data : [])
      })
      .catch((error) => {
        console.error('Failed to fetch groups:', error)
        setGroups([])
      })
  }, [setSymbols, setGroups])

  // Debounced user search
  const debouncedUserSearch = useDebouncedCallback(
    async (search: string) => {
      if (!search || search.length < 2) {
        setUserSearchResults([])
        return
      }

      try {
        const users = await searchAdminUsers(search)
        setUserSearchResults(
          users.map((u) => ({
            id: u.id,
            label: `${u.firstName || ''} ${u.lastName || ''} (${u.email})`.trim() || u.email,
          }))
        )
        setUsers(users)
      } catch (error) {
        console.error('Failed to search users:', error)
        setUserSearchResults([])
      }
    },
    250
  )

  useEffect(() => {
    debouncedUserSearch(userSearch)
  }, [userSearch, debouncedUserSearch])

  const handleUserSelect = useCallback(
    (userId: string) => {
      setSelectedUserId(userId)
      setFilters({ userId })
      setUserSearch('')
      setUserSearchResults([])
    },
    [setFilters]
  )

  const handleClearUser = useCallback(() => {
    setSelectedUserId(undefined)
    setFilters({ userId: undefined })
    setUserSearch('')
    setUserSearchResults([])
  }, [setFilters])

  const hasActiveFilters =
    filters.status || filters.symbol || filters.userId || filters.groupId || filters.search

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border bg-surface-1">
      {/* Status Filter */}
      <Select
        value={filters.status || 'all'}
        onValueChange={(value) => setFilters({ status: value === 'all' ? undefined : value })}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="filled">Filled</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      {/* Symbol Filter */}
      <Select
        value={filters.symbol || 'all'}
        onValueChange={(value) => setFilters({ symbol: value === 'all' ? undefined : value })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Symbol" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Symbols</SelectItem>
          {Array.isArray(symbols) && symbols.map((symbol) => (
            <SelectItem key={symbol.id} value={symbol.code}>
              {symbol.code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* User Search */}
      <div className="relative w-[240px]">
        <Input
          placeholder="Search user..."
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          className="w-full"
        />
        {selectedUserId && (
          <button
            onClick={handleClearUser}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-2 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {userSearchResults.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-surface-1 border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {userSearchResults.map((user) => (
              <button
                key={user.id}
                onClick={() => handleUserSelect(user.id)}
                className="w-full text-left px-3 py-2 hover:bg-surface-2 text-sm"
              >
                {user.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Group Filter */}
      <Select
        value={filters.groupId || 'all'}
        onValueChange={(value) => setFilters({ groupId: value === 'all' ? undefined : value })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Group" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Groups</SelectItem>
          {Array.isArray(groups) && groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search Input */}
      <Input
        placeholder="Search..."
        value={filters.search || ''}
        onChange={(e) => setFilters({ search: e.target.value })}
        className="flex-1 min-w-[200px]"
      />

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear
        </Button>
      )}
    </div>
  )
}

