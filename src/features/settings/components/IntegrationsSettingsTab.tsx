import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { toast } from '@/shared/components/common'
import { Activity, Loader2, RefreshCw, Save, Lock } from 'lucide-react'
import {
  getDataProvidersConfig,
  updateDataProvidersConfig,
  testDataProviderWsUrl,
  type DataProvidersConfig,
  type DataProviderEntry,
} from '../api/dataProviders.api'

function providerById(providers: DataProviderEntry[], id: string): DataProviderEntry | undefined {
  return providers.find((p) => p.id === id)
}

export function IntegrationsSettingsTab({
  canEdit,
}: {
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'settings', 'data-providers'],
    queryFn: getDataProvidersConfig,
  })

  const [draft, setDraft] = useState<DataProvidersConfig | null>(null)

  useEffect(() => {
    if (!query.data) return
    setDraft(structuredClone(query.data))
  }, [query.data])

  const binance = useMemo(() => providerById(draft?.providers ?? [], 'binance'), [draft])

  const saveMutation = useMutation({
    mutationFn: updateDataProvidersConfig,
    onSuccess: (res) => {
      queryClient.setQueryData(['admin', 'settings', 'data-providers'], res.config)
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'data-providers'] })
      toast.success(res.message ?? 'Data provider settings saved')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save')
    },
  })

  const wsTestMutation = useMutation({
    mutationFn: () => testDataProviderWsUrl(binance?.wsUrl),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.detail ?? 'WebSocket connection OK')
      } else {
        toast.error(res.error ?? 'WebSocket test failed')
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'WebSocket test request failed')
    },
  })

  const updateProvider = (id: string, patch: Partial<DataProviderEntry>) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }
    })
  }

  const handleSave = () => {
    if (!draft) return
    const next: DataProvidersConfig = {
      ...draft,
      version: 1,
      providers: draft.providers.map((p) =>
        p.type === 'binance' ? { ...p, enabled: true } : p
      ),
    }
    saveMutation.mutate(next)
  }

  const handleReset = () => {
    if (query.data) {
      setDraft(structuredClone(query.data))
      toast.success('Reverted to last saved configuration')
    }
  }

  if (query.isLoading || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading integrations…
      </div>
    )
  }

  if (query.isError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">Could not load data provider settings.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <Card className="p-6">
        <h3 className="text-base font-semibold text-text">Market data providers</h3>
        <p className="mt-1 text-sm text-text-muted">
          Configure upstream price feeds. Binance powers crypto symbols; forex and other non-spot instruments use
          MMDPS when configured on the data-provider service (
          <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">MMDPS_API_KEY</code>).
        </p>
      </Card>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-text">{binance?.displayName ?? 'Binance'}</h3>
            <p className="mt-1 text-sm text-text-muted">
              Spot bookTicker stream (required for crypto). Always on.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-sm text-text-muted">
            <Lock className="h-4 w-4" />
            <span>Enabled</span>
            <Switch checked disabled className="opacity-70" />
          </div>
        </div>
        <div className="mt-6">
          <label className="mb-1.5 block text-sm font-medium text-text">WebSocket URL</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <Input
              className="min-w-0 flex-1"
              value={binance?.wsUrl ?? ''}
              onChange={(e) =>
                updateProvider('binance', {
                  wsUrl: e.target.value.trim() === '' ? null : e.target.value,
                })
              }
              placeholder="wss://stream.binance.com:9443/ws (leave empty for server default)"
              disabled={!canEdit}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 sm:w-auto"
              disabled={!canEdit || wsTestMutation.isPending}
              onClick={() => wsTestMutation.mutate()}
            >
              {wsTestMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Activity className="mr-2 h-4 w-4" />
              )}
              Test connection
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            Override only if you use a different Binance multiplex endpoint. Empty uses the data-provider
            default from environment (
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">BINANCE_WS_URL</code> or public
            Binance). Test runs from the auth-service host: connects, subscribes to{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">btcusdt@bookTicker</code>, expects a
            ticker message.
          </p>
        </div>
      </Card>

      <Card className="p-6 border-dashed">
        <h3 className="text-base font-semibold text-text">More providers</h3>
        <p className="mt-1 text-sm text-text-muted">
          Forex and CFD pricing is supplied by MMDPS from the data-provider (not configured here). When you add
          another venue, extend the backend feed router and this screen can list it.
        </p>
      </Card>

      {canEdit && (
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={saveMutation.isPending || query.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save integrations
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
