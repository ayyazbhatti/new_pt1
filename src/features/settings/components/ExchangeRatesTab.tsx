import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, AlertTriangle, Loader2 } from 'lucide-react'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/components/common'
import { getApiErrorMessage } from '@/shared/api/http'
import { getFxRates, refreshFxRates } from '../api/fxRates.api'

type Props = {
  canView: boolean
  canEdit: boolean
}

export function ExchangeRatesTab({ canView, canEdit }: Props) {
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'fx-rates'],
    queryFn: getFxRates,
    enabled: canView,
    staleTime: 30_000,
  })

  const refreshMutation = useMutation({
    mutationFn: refreshFxRates,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin', 'fx-rates'], data)
      toast.success('Exchange rates refreshed')
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err) || 'Refresh failed')
    },
  })

  if (!canView) {
    return (
      <p className="text-sm text-text-muted">
        You need the <span className="font-mono text-text">settings:view</span> permission to view exchange rates.
      </p>
    )
  }

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading FX rates…
      </div>
    )
  }

  if (q.isError) {
    return (
      <p className="text-sm text-danger">
        Could not load FX rates. {getApiErrorMessage(q.error)}
      </p>
    )
  }

  const data = q.data!
  const entries = Object.entries(data.rates).sort(([a], [b]) => a.localeCompare(b))
  const empty = entries.length === 0

  return (
    <div className="space-y-6">
      {data.isStale && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-amber-100">Rates are stale</p>
            <p className="mt-1 text-amber-200/90">
              Last successful fetch:{' '}
              {data.fetchedAt
                ? new Date(data.fetchedAt).toLocaleString(undefined, { timeZone: 'UTC' }) + ' UTC'
                : 'unknown'}
              . Upstream APIs may be unavailable; showing cached values.
            </p>
          </div>
        </div>
      )}

      {empty && (
        <p className="text-sm text-text-muted">
          Rates not yet fetched. {canEdit ? 'Click Refresh now to load initial rates.' : 'Ask an admin with settings:edit to refresh.'}
        </p>
      )}

      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-text">USD base rates</h3>
            <p className="mt-1 text-sm text-text-muted">
              ECB-style feeds (Frankfurter, fallback open.er-api). 1 USD = N units of each currency. Used by upcoming
              display-currency and equity normalization features.
            </p>
            {data.fetchedAt && (
              <p className="mt-2 text-xs text-text-muted">
                Last refreshed:{' '}
                <span className="font-mono text-text">
                  {new Date(data.fetchedAt).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
                </span>{' '}
                <span className="text-text-muted">(source: {data.source})</span>
              </p>
            )}
          </div>
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
              className="shrink-0 gap-2"
            >
              {refreshMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh now
            </Button>
          )}
        </div>

        {!empty && (
          <div className="mt-6 max-h-[480px] overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2">Currency</th>
                  <th className="px-3 py-2">1 USD =</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([code, rate]) => (
                  <tr key={code} className="border-t border-border/60 hover:bg-surface-2/50">
                    <td className="px-3 py-2 font-mono font-medium text-text">{code}</td>
                    <td className="px-3 py-2 font-mono text-text">{rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
