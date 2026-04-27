import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { toast } from '@/shared/components/common'
import { Activity, Loader2, RefreshCw, Save, Lock, Eye, EyeOff, KeyRound } from 'lucide-react'
import {
  getDataProvidersConfig,
  updateDataProvidersConfig,
  testDataProviderWsUrl,
  type DataProvidersApiResponse,
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
  /** New key only — never pre-filled from API (secret is not returned). */
  const [mmdpsApiKeyInput, setMmdpsApiKeyInput] = useState('')
  const [showMmdpsKey, setShowMmdpsKey] = useState(false)
  /** When true, next save sends mmdpsApiKey: "" to clear the stored key. */
  const [clearMmdpsKeyPending, setClearMmdpsKeyPending] = useState(false)

  useEffect(() => {
    if (!query.data) return
    setDraft(structuredClone(query.data))
  }, [query.data])

  const binance = useMemo(() => providerById(draft?.providers ?? [], 'binance'), [draft])

  const saveMutation = useMutation({
    mutationFn: (params: {
      config: DataProvidersConfig
      mmdpsKeyAction: 'omit' | 'clear' | 'replace'
      newKey?: string
    }) => {
      if (params.mmdpsKeyAction === 'clear') {
        return updateDataProvidersConfig(params.config, { mmdpsApiKey: '' })
      }
      if (params.mmdpsKeyAction === 'replace' && params.newKey) {
        return updateDataProvidersConfig(params.config, { mmdpsApiKey: params.newKey })
      }
      return updateDataProvidersConfig(params.config)
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['admin', 'settings', 'data-providers'], res.config as DataProvidersApiResponse)
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'data-providers'] })
      setMmdpsApiKeyInput('')
      setClearMmdpsKeyPending(false)
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
    if (clearMmdpsKeyPending) {
      saveMutation.mutate({ config: next, mmdpsKeyAction: 'clear' })
      return
    }
    if (mmdpsApiKeyInput.trim() !== '') {
      saveMutation.mutate({
        config: next,
        mmdpsKeyAction: 'replace',
        newKey: mmdpsApiKeyInput.trim(),
      })
      return
    }
    saveMutation.mutate({ config: next, mmdpsKeyAction: 'omit' })
  }

  const handleReset = () => {
    if (query.data) {
      setDraft(structuredClone(query.data))
      setMmdpsApiKeyInput('')
      setClearMmdpsKeyPending(false)
      toast.success('Reverted to last saved configuration')
    }
  }

  const mmdpsConfigured = Boolean((query.data as DataProvidersApiResponse | undefined)?.mmdpsApiKeyConfigured)

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
          Configure upstream price feeds. Binance powers crypto symbols; forex and CFD symbols use MMDPS when an API
          key is configured below or via the data-provider environment.
        </p>
      </Card>

      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-surface-2 p-2 text-accent">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">MMDPS API key</h3>
              <p className="mt-1 text-sm text-text-muted max-w-xl">
                Required for forex and non-Binance symbols: live WebSocket feed, chart history, and “Sync from MMDPS”
                in Symbols. The key is stored server-side in the database and mirrored to Redis for the data-provider.
                It is never returned to this screen after you save—only replaced or removed.
              </p>
              <p className="mt-2 text-xs text-text-muted">
                You can still set <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.65rem]">MMDPS_API_KEY</code>{' '}
                on the server; a key saved here overrides the environment value for runtime services.
              </p>
            </div>
          </div>
          <div
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
              mmdpsConfigured
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-surface-2 text-text-muted'
            }`}
          >
            {mmdpsConfigured ? 'Key stored' : 'Not configured'}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-text" htmlFor="mmdps-api-key-input">
            API key
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <Input
                id="mmdps-api-key-input"
                className="pr-10 font-mono text-sm"
                type={showMmdpsKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={mmdpsApiKeyInput}
                onChange={(e) => {
                  setMmdpsApiKeyInput(e.target.value)
                  setClearMmdpsKeyPending(false)
                }}
                placeholder={mmdpsConfigured ? 'Enter a new key to replace the stored key' : 'Paste your MMDPS API key'}
                disabled={!canEdit}
              />
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
                aria-label={showMmdpsKey ? 'Hide key' : 'Show key'}
                onClick={() => setShowMmdpsKey((v) => !v)}
                tabIndex={-1}
              >
                {showMmdpsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {canEdit && mmdpsConfigured && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setClearMmdpsKeyPending(true)
                  setMmdpsApiKeyInput('')
                }}
              >
                Remove stored key
              </Button>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Leave blank to keep the current key unchanged. Use <strong className="font-medium text-text">Remove stored key</strong>{' '}
            to clear it (services may fall back to environment variables after you restart the data-provider).
          </p>
          {clearMmdpsKeyPending && (
            <p className="text-xs text-warning">
              Removal pending—click “Save integrations” to apply.
            </p>
          )}
        </div>
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
