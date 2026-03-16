import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listAllUsers, type UserResponse } from '@/shared/api/users.api'
import { createDirectDeposit } from '@/features/adminFinance/api/finance.api'
import { useCanAccess } from '@/shared/utils/permissions'
import { Button, Input, Label } from '@/shared/ui'
import { formatCurrency } from '@/features/adminUsers/utils/formatters'
import { toast } from '@/shared/components/common'
import { Loader2, CheckSquare, Square, Search, DollarSign } from 'lucide-react'
import { cn } from '@/shared/utils'

export function BulkDepositSection() {
  const queryClient = useQueryClient()
  const canApproveDeposit = useCanAccess('deposits:approve')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [search, setSearch] = useState('')

  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['users', 'bulk-deposit', 'all', search],
    queryFn: () => listAllUsers({ search: search.trim() || undefined }),
    staleTime: 60 * 1000,
  })

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.trim().toLowerCase()
    return users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.first_name?.toLowerCase().includes(q) ||
        u.last_name?.toLowerCase().includes(q)
    )
  }, [users, search])

  const allFilteredIds = useMemo(() => new Set(filteredUsers.map((u) => u.id)), [filteredUsers])
  const allSelected = allFilteredIds.size > 0 && allFilteredIds.size === filteredUsers.filter((u) => selectedIds.has(u.id)).length
  const someSelected = selectedIds.size > 0

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        allFilteredIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        allFilteredIds.forEach((id) => next.add(id))
        return next
      })
    }
  }, [allSelected, allFilteredIds])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const handleProceed = useCallback(async () => {
    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount greater than 0')
      return
    }
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error('Please select at least one user')
      return
    }

    setIsSubmitting(true)
    let succeeded = 0
    const failed: { id: string; reason: string }[] = []

    for (let i = 0; i < ids.length; i++) {
      try {
        await createDirectDeposit({
          userId: ids[i],
          amount: amountNum,
          note: note.trim() || undefined,
        })
        succeeded++
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error
            ?.message ??
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err instanceof Error ? err.message : 'Unknown error')
        failed.push({ id: ids[i], reason: String(msg) })
      }
    }

    setIsSubmitting(false)

    if (failed.length === 0) {
      toast.success(
        `${succeeded} deposit${succeeded === 1 ? '' : 's'} of ${formatCurrency(amountNum, 'USD')} applied successfully.`
      )
      setAmount('')
      setNote('')
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } else if (succeeded > 0) {
      toast.error(
        `${succeeded} succeeded, ${failed.length} failed. First failure: ${failed[0].reason}`
      )
    } else {
      toast.error(failed[0]?.reason ?? 'All deposits failed')
    }
  }, [amount, note, selectedIds, queryClient])

  if (!canApproveDeposit) {
    return (
      <div className="rounded-lg border border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
        You don’t have permission to approve deposits. Contact an administrator to use bulk direct deposit.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bulk-deposit-amount" className="text-sm font-medium text-text">
            Amount (USD) per user *
          </Label>
          <div className="mt-1 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-text-muted" />
            <Input
              id="bulk-deposit-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="max-w-[200px]"
              disabled={isSubmitting}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="bulk-deposit-note" className="text-sm font-medium text-text">
            Note (optional)
          </Label>
          <Input
            id="bulk-deposit-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Bulk deposit — March 2025"
            className="mt-1"
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <span>
            {selectedIds.size} of {filteredUsers.length} selected
          </span>
          {someSelected && (
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection} className="text-text-muted">
              Clear selection
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="max-h-[320px] overflow-auto bg-surface-2">
          {usersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
          ) : usersError ? (
            <div className="py-8 text-center text-sm text-danger">
              Failed to load users. Please try again.
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">
              No users match your search.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-surface-2">
                <tr>
                  <th className="w-10 px-4 py-3 text-left">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:bg-surface-1 hover:text-text"
                      title={allSelected ? 'Deselect all' : 'Select all'}
                    >
                      {allSelected ? (
                        <CheckSquare className="h-5 w-5 text-accent" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-text-muted">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-text-muted">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={cn(
                      'hover:bg-surface-1/50',
                      selectedIds.has(user.id) && 'bg-accent/5'
                    )}
                  >
                    <td className="w-10 px-4 py-2">
                      <button
                        type="button"
                        onClick={() => toggleOne(user.id)}
                        className="flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:bg-surface-1 hover:text-text"
                      >
                        {selectedIds.has(user.id) ? (
                          <CheckSquare className="h-5 w-5 text-accent" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-text">
                      {user.first_name} {user.last_name}
                    </td>
                    <td className="px-4 py-2 text-text-muted">{user.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          onClick={handleProceed}
          disabled={isSubmitting || selectedIds.size === 0 || !amount || parseFloat(amount) <= 0}
          className="min-w-[140px]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            'Proceed'
          )}
        </Button>
        <span className="text-sm text-text-muted">
          {selectedIds.size > 0 && amount && parseFloat(amount) > 0
            ? `${formatCurrency(selectedIds.size * parseFloat(amount), 'USD')} total will be deposited to ${selectedIds.size} user(s).`
            : 'Select users and enter an amount to proceed.'}
        </span>
      </div>
    </div>
  )
}
