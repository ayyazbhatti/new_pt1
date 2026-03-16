import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listAllUsers, type UserResponse } from '@/shared/api/users.api'
import { createAdminOrder } from '@/features/adminTrading/api/orders'
import { fetchAdminSymbols } from '@/features/adminTrading/api/lookups'
import type { CreateOrderRequest } from '@/features/adminTrading/types'
import { useCanAccess } from '@/shared/utils/permissions'
import { Button, Input, Label } from '@/shared/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { toast } from '@/shared/components/common'
import { Loader2, CheckSquare, Square, Search, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/shared/utils'

const DEFAULT_ORDER_FORM: Omit<CreateOrderRequest, 'userId'> = {
  symbolId: '',
  side: 'BUY',
  orderType: 'MARKET',
  size: 0,
  price: undefined,
  stopPrice: undefined,
  timeInForce: 'GTC',
  stopLoss: undefined,
  takeProfit: undefined,
}

export function BulkPositionSection() {
  const queryClient = useQueryClient()
  const canCreateOrder = useCanAccess('trading:create_order')
  const symbolDropdownRef = useRef<HTMLDivElement>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [orderForm, setOrderForm] = useState<Omit<CreateOrderRequest, 'userId'>>(DEFAULT_ORDER_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')

  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['users', 'bulk-positions', 'all', search],
    queryFn: () => listAllUsers({ search: search.trim() || undefined }),
    staleTime: 60 * 1000,
  })

  const { data: symbols = [], isLoading: symbolsLoading } = useQuery({
    queryKey: ['admin', 'symbols'],
    queryFn: fetchAdminSymbols,
    staleTime: 5 * 60 * 1000,
  })

  const symbolsFiltered = useMemo(() => {
    if (!symbolSearch.trim()) return symbols
    const q = symbolSearch.trim().toLowerCase()
    return symbols.filter(
      (s) =>
        s.code?.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q)
    )
  }, [symbols, symbolSearch])

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
  const allSelected =
    allFilteredIds.size > 0 &&
    filteredUsers.filter((u) => selectedIds.has(u.id)).length === allFilteredIds.size
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

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (symbolDropdownRef.current?.contains(e.target as Node)) return
      setSymbolDropdownOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const handleProceed = useCallback(async () => {
    if (!orderForm.symbolId || orderForm.size <= 0) {
      toast.error('Please fill in Symbol and Size')
      return
    }
    if (
      (orderForm.orderType === 'LIMIT' || orderForm.orderType === 'STOP_LIMIT') &&
      (orderForm.price == null || orderForm.price <= 0)
    ) {
      toast.error('Please enter a limit price')
      return
    }
    if (
      (orderForm.orderType === 'STOP' || orderForm.orderType === 'STOP_LIMIT') &&
      (orderForm.stopPrice == null || orderForm.stopPrice <= 0)
    ) {
      toast.error('Please enter a stop price')
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

    const payload: CreateOrderRequest = {
      ...orderForm,
      userId: '',
    }

    for (let i = 0; i < ids.length; i++) {
      try {
        await createAdminOrder({ ...payload, userId: ids[i] })
        succeeded++
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data
            ?.error?.message ??
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err instanceof Error ? err.message : 'Unknown error')
        failed.push({ id: ids[i], reason: String(msg) })
      }
    }

    setIsSubmitting(false)

    if (failed.length === 0) {
      toast.success(`${succeeded} order${succeeded === 1 ? '' : 's'} created successfully.`)
      setSelectedIds(new Set())
      setOrderForm(DEFAULT_ORDER_FORM)
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['user-positions'] })
    } else if (succeeded > 0) {
      toast.error(`${succeeded} succeeded, ${failed.length} failed. First failure: ${failed[0].reason}`)
    } else {
      toast.error(failed[0]?.reason ?? 'All orders failed')
    }
  }, [orderForm, selectedIds, queryClient])

  const canSubmit =
    orderForm.symbolId &&
    orderForm.size > 0 &&
    (orderForm.orderType !== 'LIMIT' && orderForm.orderType !== 'STOP_LIMIT'
      ? true
      : (orderForm.price ?? 0) > 0) &&
    (orderForm.orderType !== 'STOP' && orderForm.orderType !== 'STOP_LIMIT'
      ? true
      : (orderForm.stopPrice ?? 0) > 0) &&
    selectedIds.size > 0

  if (!canCreateOrder) {
    return (
      <div className="rounded-lg border border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
        You don’t have permission to create orders. Contact an administrator to use bulk position creation.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <h3 className="text-sm font-semibold text-text mb-3">Order (same for all selected users)</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative" ref={symbolDropdownRef}>
            <Label className="text-text-muted text-xs">Symbol *</Label>
            <button
              type="button"
              onClick={() => !symbolsLoading && setSymbolDropdownOpen((o) => !o)}
              disabled={symbolsLoading}
              className={cn(
                'mt-1 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-left flex items-center justify-between gap-2',
                'text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent',
                symbolDropdownOpen && 'ring-2 ring-accent',
                symbolsLoading && 'opacity-60 cursor-not-allowed'
              )}
            >
              <span className="truncate">
                {symbolsLoading
                  ? 'Loading…'
                  : orderForm.symbolId
                    ? symbols.find((s) => s.id === orderForm.symbolId)?.code ?? 'Select'
                    : 'Select'}
              </span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-text-muted', symbolDropdownOpen && 'rotate-180')} />
            </button>
            {symbolDropdownOpen && (
              <div
                className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-[min(50vh,280px)] flex-col overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg"
              >
                <div className="shrink-0 border-b border-border p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    <Input
                      placeholder="Search symbols..."
                      value={symbolSearch}
                      onChange={(e) => setSymbolSearch(e.target.value)}
                      className="pl-8 h-9 text-sm bg-surface-1 border-border text-text"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {symbolsFiltered.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-text-muted">No symbols match</div>
                  ) : (
                    symbolsFiltered.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setOrderForm((f) => ({ ...f, symbolId: s.id }))
                          setSymbolDropdownOpen(false)
                          setSymbolSearch('')
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium transition-colors',
                          orderForm.symbolId === s.id ? 'bg-accent/20 text-accent' : 'text-text hover:bg-surface-1'
                        )}
                      >
                        <span className="truncate">{s.code}</span>
                        {orderForm.symbolId === s.id ? <Check className="h-4 w-4 shrink-0" /> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <div>
            <Label className="text-text-muted text-xs">Side *</Label>
            <Select
              value={orderForm.side}
              onValueChange={(v) => setOrderForm((f) => ({ ...f, side: v as 'BUY' | 'SELL' }))}
            >
              <SelectTrigger className="mt-1 h-9 bg-surface-1 border-border text-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BUY">BUY</SelectItem>
                <SelectItem value="SELL">SELL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-text-muted text-xs">Type *</Label>
            <Select
              value={orderForm.orderType}
              onValueChange={(v) =>
                setOrderForm((f) => ({ ...f, orderType: v as CreateOrderRequest['orderType'] }))
              }
            >
              <SelectTrigger className="mt-1 h-9 bg-surface-1 border-border text-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKET">MARKET</SelectItem>
                <SelectItem value="LIMIT">LIMIT</SelectItem>
                <SelectItem value="STOP">STOP</SelectItem>
                <SelectItem value="STOP_LIMIT">STOP_LIMIT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-text-muted text-xs">Size *</Label>
            <Input
              type="number"
              step="0.000001"
              min={0}
              value={orderForm.size || ''}
              onChange={(e) => setOrderForm((f) => ({ ...f, size: parseFloat(e.target.value) || 0 }))}
              className="mt-1 h-9 bg-surface-1 border-border text-text"
              disabled={isSubmitting}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(orderForm.orderType === 'LIMIT' || orderForm.orderType === 'STOP_LIMIT') && (
            <div>
              <Label className="text-text-muted text-xs">Price *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={orderForm.price ?? ''}
                onChange={(e) =>
                  setOrderForm((f) => ({ ...f, price: parseFloat(e.target.value) || undefined }))
                }
                className="mt-1 h-9 bg-surface-1 border-border text-text"
                disabled={isSubmitting}
              />
            </div>
          )}
          {(orderForm.orderType === 'STOP' || orderForm.orderType === 'STOP_LIMIT') && (
            <div>
              <Label className="text-text-muted text-xs">Stop price *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={orderForm.stopPrice ?? ''}
                onChange={(e) =>
                  setOrderForm((f) => ({ ...f, stopPrice: parseFloat(e.target.value) || undefined }))
                }
                className="mt-1 h-9 bg-surface-1 border-border text-text"
                disabled={isSubmitting}
              />
            </div>
          )}
          <div>
            <Label className="text-text-muted text-xs">Time in force</Label>
            <Select
              value={orderForm.timeInForce ?? 'GTC'}
              onValueChange={(v) =>
                setOrderForm((f) => ({ ...f, timeInForce: (v || 'GTC') as 'GTC' | 'IOC' | 'FOK' }))
              }
            >
              <SelectTrigger className="mt-1 h-9 bg-surface-1 border-border text-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GTC">GTC</SelectItem>
                <SelectItem value="IOC">IOC</SelectItem>
                <SelectItem value="FOK">FOK</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-text-muted text-xs">Stop loss (opt)</Label>
            <Input
              type="number"
              step="0.01"
              value={orderForm.stopLoss ?? ''}
              onChange={(e) =>
                setOrderForm((f) => ({ ...f, stopLoss: parseFloat(e.target.value) || undefined }))
              }
              className="mt-1 h-9 bg-surface-1 border-border text-text"
              disabled={isSubmitting}
            />
          </div>
          <div>
            <Label className="text-text-muted text-xs">Take profit (opt)</Label>
            <Input
              type="number"
              step="0.01"
              value={orderForm.takeProfit ?? ''}
              onChange={(e) =>
                setOrderForm((f) => ({ ...f, takeProfit: parseFloat(e.target.value) || undefined }))
              }
              className="mt-1 h-9 bg-surface-1 border-border text-text"
              disabled={isSubmitting}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
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

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="max-h-[320px] overflow-auto bg-surface-2">
          {usersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
          ) : usersError ? (
            <div className="py-8 text-center text-sm text-danger">Failed to load users. Please try again.</div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">No users match your search.</div>
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
                    className={cn('hover:bg-surface-1/50', selectedIds.has(user.id) && 'bg-accent/5')}
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
        <Button onClick={handleProceed} disabled={isSubmitting || !canSubmit} className="min-w-[140px]">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            'Create orders'
          )}
        </Button>
        <span className="text-sm text-text-muted">
          {canSubmit
            ? `Create 1 order per user for ${selectedIds.size} user(s) (same symbol, side, size, etc.).`
            : 'Select users, choose symbol, side, type, and size, then click Create orders.'}
        </span>
      </div>
    </div>
  )
}
