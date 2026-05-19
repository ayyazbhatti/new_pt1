import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, KeyRound, Loader2, RefreshCw, Save } from 'lucide-react'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import { toast } from '@/shared/components/common'
import { getVoisoConfig, updateVoisoConfig, type VoisoConfigResponse } from '../api/voisoConfig.api'

const DEFAULT_CLICK2CALL_URL = 'https://cc-ams03.voiso.com/api/v1'
const DEFAULT_PANEL_URL = 'https://cc-ams03.voiso.com/omnichannel/embedded'

export function VoisoSettingsTab({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'settings', 'voiso'],
    queryFn: getVoisoConfig,
  })

  const [enabled, setEnabled] = useState(true)
  const [click2callUrl, setClick2callUrl] = useState(DEFAULT_CLICK2CALL_URL)
  const [panelUrl, setPanelUrl] = useState(DEFAULT_PANEL_URL)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [clearApiKeyPending, setClearApiKeyPending] = useState(false)

  useEffect(() => {
    if (!query.data) return
    setEnabled(query.data.enabled)
    setClick2callUrl(query.data.click2callUrl || DEFAULT_CLICK2CALL_URL)
    setPanelUrl(query.data.panelUrl || DEFAULT_PANEL_URL)
    setApiKeyInput('')
    setClearApiKeyPending(false)
  }, [query.data])

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        click2callUrl: click2callUrl.trim(),
        panelUrl: panelUrl.trim(),
        enabled,
        ...(clearApiKeyPending
          ? { apiKey: '' }
          : apiKeyInput.trim()
            ? { apiKey: apiKeyInput.trim() }
            : {}),
      }
      return updateVoisoConfig(payload)
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['admin', 'settings', 'voiso'], res)
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'voiso'] })
      setApiKeyInput('')
      setClearApiKeyPending(false)
      toast.success('Voiso settings saved')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save Voiso settings')
    },
  })

  const handleReset = () => {
    const data = query.data
    if (!data) return
    setEnabled(data.enabled)
    setClick2callUrl(data.click2callUrl || DEFAULT_CLICK2CALL_URL)
    setPanelUrl(data.panelUrl || DEFAULT_PANEL_URL)
    setApiKeyInput('')
    setClearApiKeyPending(false)
    toast.success('Reverted to last saved Voiso settings')
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Voiso settings…
      </div>
    )
  }

  if (query.isError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">Could not load Voiso settings.</p>
      </Card>
    )
  }

  const config = query.data as VoisoConfigResponse

  return (
    <div className="space-y-8">
      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-surface-2 p-2 text-accent">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Voiso API integration</h3>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">
                Store the Voiso Click2Call API key and endpoint used by the Admin Voiso page. The key is saved
                server-side and is never returned to the browser after saving.
              </p>
            </div>
          </div>
          <div
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
              config.apiKeyConfigured
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-surface-2 text-text-muted'
            }`}
          >
            {config.apiKeyConfigured ? 'API key configured' : 'No API key'}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 rounded-md border border-border bg-surface-1 p-3">
          <div>
            <p className="text-sm font-medium text-text">Enable Voiso integration</p>
            <p className="text-xs text-text-muted">When disabled, Click2Call requests return a configuration error.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
        </div>

        <div className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-text" htmlFor="voiso-api-key-input">
            Voiso API key
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="relative min-w-0 flex-1">
              <Input
                id="voiso-api-key-input"
                className="pr-10 font-mono text-sm"
                type={showApiKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value)
                  setClearApiKeyPending(false)
                }}
                placeholder={config.apiKeyConfigured ? 'Enter a new key to replace the current key' : 'Paste Voiso API key'}
                disabled={!canEdit}
              />
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
                aria-label={showApiKey ? 'Hide key' : 'Show key'}
                onClick={() => setShowApiKey((v) => !v)}
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {canEdit && config.storedApiKeyConfigured && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setClearApiKeyPending(true)
                  setApiKeyInput('')
                }}
              >
                Remove stored key
              </Button>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Leave blank to keep the current key. If no stored key exists, the backend can still use{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">VOISO_API_KEY</code> from the server
            environment.
          </p>
          {config.envApiKeyConfigured && !config.storedApiKeyConfigured && (
            <p className="text-xs text-warning">
              An environment API key is currently configured. Saving a key here will override it for Click2Call.
            </p>
          )}
          {clearApiKeyPending && (
            <p className="text-xs text-warning">Removal pending—click “Save Voiso settings” to apply.</p>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold text-text">Voiso endpoints</h3>
        <p className="mt-1 text-sm text-text-muted">
          Keep the default cluster URLs unless Voiso gives you a different cluster or API endpoint.
        </p>
        <div className="mt-6 grid gap-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text" htmlFor="voiso-click2call-url">
              Click2Call base URL
            </label>
            <Input
              id="voiso-click2call-url"
              value={click2callUrl}
              onChange={(e) => setClick2callUrl(e.target.value)}
              placeholder={DEFAULT_CLICK2CALL_URL}
              disabled={!canEdit}
            />
            <p className="mt-1.5 text-xs text-text-muted">
              The backend calls <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">{'{base}/{apiKey}/click2call'}</code>.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text" htmlFor="voiso-panel-url">
              Embedded agent panel URL
            </label>
            <Input
              id="voiso-panel-url"
              value={panelUrl}
              onChange={(e) => setPanelUrl(e.target.value)}
              placeholder={DEFAULT_PANEL_URL}
              disabled={!canEdit}
            />
            <p className="mt-1.5 text-xs text-text-muted">
              Use the <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">/omnichannel/embedded</code>{' '}
              URL so Voiso allows the panel inside an iframe.
            </p>
          </div>
        </div>
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
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Voiso settings
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
