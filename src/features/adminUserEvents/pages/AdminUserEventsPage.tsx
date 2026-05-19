import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useDebouncedValue } from '@/shared/hooks/useDebounce'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty'
import { useCanAccess } from '@/shared/utils/permissions'
import { getApiErrorMessage } from '@/shared/api/http'
import { listUserEvents } from '../api/userEvents.api'
import { UserEventsFiltersBar } from '../components/UserEventsFiltersBar'
import { UserEventsStatsCards } from '../components/UserEventsStatsCards'
import { UserEventsTable } from '../components/UserEventsTable'
import type { UserEventItem } from '../types'
import {
  defaultUserEventFilters,
  toApiFrom,
  toApiTo,
} from '../utils/dateRange'
import { History, Loader2, X } from 'lucide-react'

export function AdminUserEventsPage() {
  const canView = useCanAccess('user_events:view')
  const [searchParams, setSearchParams] = useSearchParams()
  const urlUserId = searchParams.get('userId') ?? ''

  const [filters, setFilters] = useState(() => defaultUserEventFilters(urlUserId))
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [accumulated, setAccumulated] = useState<UserEventItem[]>([])

  const debouncedSearch = useDebouncedValue(filters.search, 400)

  useEffect(() => {
    if (urlUserId && urlUserId !== filters.userId) {
      setFilters((prev) => ({ ...prev, userId: urlUserId }))
    }
  }, [urlUserId, filters.userId])

  useEffect(() => {
    setCursor(undefined)
    setAccumulated([])
  }, [
    debouncedSearch,
    filters.category,
    filters.eventType,
    filters.deviceClass,
    filters.userId,
    filters.dateFrom,
    filters.dateTo,
  ])

  const queryKey = [
    'user-events',
    debouncedSearch,
    filters.category,
    filters.eventType,
    filters.deviceClass,
    filters.userId,
    filters.dateFrom,
    filters.dateTo,
    cursor,
  ] as const

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      listUserEvents({
        search: debouncedSearch.trim() || undefined,
        category: filters.category !== 'all' ? filters.category : undefined,
        eventType: filters.eventType !== 'all' ? filters.eventType : undefined,
        deviceClass: filters.deviceClass !== 'all' ? filters.deviceClass : undefined,
        userId: filters.userId.trim() || undefined,
        from: toApiFrom(filters.dateFrom),
        to: toApiTo(filters.dateTo),
        cursor,
        limit: 50,
      }),
    enabled: canView,
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (!data) return
    if (!cursor) {
      setAccumulated(data.items)
    } else {
      setAccumulated((prev) => {
        const ids = new Set(prev.map((i) => i.id))
        const merged = [...prev]
        for (const item of data.items) {
          if (!ids.has(item.id)) merged.push(item)
        }
        return merged
      })
    }
  }, [data, cursor])

  const total = data?.total ?? 0
  const hasMore = data?.hasMore ?? false

  const breakdown = useMemo(
    () => ({
      register: accumulated.filter((e) => e.eventType === 'auth.register').length,
      login: accumulated.filter((e) => e.eventType === 'auth.login').length,
      logout: accumulated.filter((e) => e.eventType === 'auth.logout').length,
    }),
    [accumulated]
  )

  const handleLoadMore = useCallback(() => {
    if (data?.cursor) setCursor(data.cursor)
  }, [data?.cursor])

  const clearUserFilter = useCallback(() => {
    setFilters((prev) => ({ ...prev, userId: '' }))
    const next = new URLSearchParams(searchParams)
    next.delete('userId')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const dateRangeLabel = `${filters.dateFrom} – ${filters.dateTo}`

  if (!canView) {
    return <Navigate to="/admin/dashboard" replace />
  }

  if (error && !data) {
    return (
      <ContentShell>
        <PageHeader title="User events" />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-danger mb-2">Failed to load events</div>
            <p className="text-sm text-text-muted mb-4">{getApiErrorMessage(error)}</p>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </ContentShell>
    )
  }

  const isInitialLoading = isLoading && accumulated.length === 0

  return (
    <ContentShell>
      {isInitialLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted">Loading events…</div>
        </div>
      )}
      {!isInitialLoading && (
        <>
          <PageHeader
            title="User events"
            description="Authentication and activity history. Filter by user, event type, date range, or search."
          />

          {filters.userId.trim() ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm">
              <span className="text-text-muted">Filtered by user</span>
              <span className="font-mono text-xs text-text">{filters.userId.trim()}</span>
              <button
                type="button"
                onClick={clearUserFilter}
                className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
                Clear user filter
              </button>
            </div>
          ) : null}

          <UserEventsStatsCards
            total={total}
            registerCount={breakdown.register}
            loginCount={breakdown.login}
            logoutCount={breakdown.logout}
            partialBreakdown={hasMore || accumulated.length < total}
            dateRangeLabel={dateRangeLabel}
          />

          <div className="relative">
            {isFetching && (
              <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 rounded bg-surface-2/90 px-2 py-1 text-xs text-text-muted">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
                Updating…
              </div>
            )}
            <UserEventsFiltersBar filters={filters} onFilterChange={setFilters} />
          </div>

          {accumulated.length === 0 ? (
            <div className="rounded-lg border border-border overflow-hidden">
              <EmptyState
                icon={<History className="h-12 w-12" />}
                title="No events found"
                description="No user events match your filters. Try a wider date range or different search terms."
              />
            </div>
          ) : (
            <>
              <UserEventsTable items={accumulated} />
              {hasMore ? (
                <div className="mt-4 flex justify-center">
                  <Button variant="outline" onClick={handleLoadMore} disabled={isFetching}>
                    {isFetching ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      'Load more'
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </ContentShell>
  )
}
