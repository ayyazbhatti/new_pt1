import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Loader2, RefreshCw, Save, Sparkles, Zap } from 'lucide-react'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/Switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { toast } from '@/shared/components/common'
import {
  getAiConfig,
  testAiConfig,
  updateAiConfig,
  type AiConfigDto,
} from '../api/aiConfig.api'

const DEFAULT_SYSTEM_PROMPT_PLACEHOLDER = `You are the AI assistant embedded in the NEWPT trading platform…

Leave empty to use the built-in default system prompt. Use {user_context_json} in a custom prompt to inject read-only account context.`

const CHAT_MODELS = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (recommended)' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
] as const

export function AiSettingsTab({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'settings', 'ai'],
    queryFn: getAiConfig,
  })

  const [provider, setProvider] = useState('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-5')
  const [classifierModel, setClassifierModel] = useState('claude-haiku-4-5')
  const [enabled, setEnabled] = useState(false)
  const [topicGuardEnabled, setTopicGuardEnabled] = useState(true)
  const [includeUserContext, setIncludeUserContext] = useState(true)
  const [maxTokensPerMessage, setMaxTokensPerMessage] = useState('1024')
  const [dailyTokenCapPerUser, setDailyTokenCapPerUser] = useState('50000')
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState('10')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [clearApiKeyPending, setClearApiKeyPending] = useState(false)
  const [testReply, setTestReply] = useState<string | null>(null)

  useEffect(() => {
    if (!query.data) return
    const d = query.data
    setProvider(d.provider || 'anthropic')
    setModel(d.model || 'claude-sonnet-4-5')
    setClassifierModel(d.classifierModel || 'claude-haiku-4-5')
    setEnabled(d.enabled)
    setTopicGuardEnabled(d.topicGuardEnabled)
    setIncludeUserContext(d.includeUserContext)
    setMaxTokensPerMessage(String(d.maxTokensPerMessage))
    setDailyTokenCapPerUser(String(d.dailyTokenCapPerUser))
    setRateLimitPerMinute(String(d.rateLimitPerMinute))
    setSystemPrompt(d.systemPrompt ?? '')
    setApiKeyInput('')
    setClearApiKeyPending(false)
    setTestReply(null)
  }, [query.data])

  const saveMutation = useMutation({
    mutationFn: () => {
      const maxTokens = parseInt(maxTokensPerMessage, 10)
      const dailyCap = parseInt(dailyTokenCapPerUser, 10)
      const rateLimit = parseInt(rateLimitPerMinute, 10)
      if (Number.isNaN(maxTokens) || maxTokens < 256 || maxTokens > 8192) {
        throw new Error('Max tokens per message must be between 256 and 8192')
      }
      if (Number.isNaN(dailyCap) || dailyCap < 1000 || dailyCap > 500000) {
        throw new Error('Daily token cap must be between 1000 and 500000')
      }
      if (Number.isNaN(rateLimit) || rateLimit < 1 || rateLimit > 60) {
        throw new Error('Rate limit must be between 1 and 60')
      }
      return updateAiConfig({
        provider,
        model,
        classifierModel,
        enabled,
        topicGuardEnabled,
        includeUserContext,
        maxTokensPerMessage: maxTokens,
        dailyTokenCapPerUser: dailyCap,
        rateLimitPerMinute: rateLimit,
        systemPrompt: systemPrompt.trim() || null,
        ...(clearApiKeyPending
          ? { apiKey: '' }
          : apiKeyInput.trim()
            ? { apiKey: apiKeyInput.trim() }
            : {}),
      })
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['admin', 'settings', 'ai'], res)
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'ai'] })
      setApiKeyInput('')
      setClearApiKeyPending(false)
      toast.success('AI settings saved')
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save AI settings')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => testAiConfig({ message: 'What is leverage?' }),
    onSuccess: (res) => {
      if (res.ok && res.reply) {
        setTestReply(res.reply)
        toast.success('Test connection succeeded')
      } else {
        setTestReply(null)
        toast.error(res.error || 'Test connection failed')
      }
    },
    onError: (err: Error) => {
      setTestReply(null)
      toast.error(err.message || 'Test connection failed')
    },
  })

  const handleReset = () => {
    const data = query.data
    if (!data) return
    setProvider(data.provider || 'anthropic')
    setModel(data.model || 'claude-sonnet-4-5')
    setClassifierModel(data.classifierModel || 'claude-haiku-4-5')
    setEnabled(data.enabled)
    setTopicGuardEnabled(data.topicGuardEnabled)
    setIncludeUserContext(data.includeUserContext)
    setMaxTokensPerMessage(String(data.maxTokensPerMessage))
    setDailyTokenCapPerUser(String(data.dailyTokenCapPerUser))
    setRateLimitPerMinute(String(data.rateLimitPerMinute))
    setSystemPrompt(data.systemPrompt ?? '')
    setApiKeyInput('')
    setClearApiKeyPending(false)
    setTestReply(null)
    toast.success('Reverted to last saved AI settings')
  }

  if (query.isLoading) {
    return (
      <AiLoadingState />
    )
  }

  if (query.isError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">
          Could not load AI settings. You may need the ai_settings:view permission.
        </p>
      </Card>
    )
  }

  const config = query.data as AiConfigDto

  return (
    <div className="space-y-8">
      <Card className="p-6">
        <AiSettingsHeader config={config} />
        <AiEnableRow enabled={enabled} setEnabled={setEnabled} canEdit={canEdit} />
        <AiModelRows
          provider={provider}
          setProvider={setProvider}
          model={model}
          setModel={setModel}
          classifierModel={classifierModel}
          setClassifierModel={setClassifierModel}
          canEdit={canEdit}
        />
        <AiApiKeySection
          config={config}
          canEdit={canEdit}
          apiKeyInput={apiKeyInput}
          setApiKeyInput={setApiKeyInput}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          clearApiKeyPending={clearApiKeyPending}
          setClearApiKeyPending={setClearApiKeyPending}
          savePending={saveMutation.isPending}
        />
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold text-text">Limits &amp; behavior</h3>
        <p className="mt-1 text-sm text-text-muted">Rate limits and context injection for trader messages.</p>
        <AiLimitsSection
          canEdit={canEdit}
          topicGuardEnabled={topicGuardEnabled}
          setTopicGuardEnabled={setTopicGuardEnabled}
          includeUserContext={includeUserContext}
          setIncludeUserContext={setIncludeUserContext}
          maxTokensPerMessage={maxTokensPerMessage}
          setMaxTokensPerMessage={setMaxTokensPerMessage}
          dailyTokenCapPerUser={dailyTokenCapPerUser}
          setDailyTokenCapPerUser={setDailyTokenCapPerUser}
          rateLimitPerMinute={rateLimitPerMinute}
          setRateLimitPerMinute={setRateLimitPerMinute}
        />
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold text-text">System prompt</h3>
        <p className="mt-1 text-sm text-text-muted">
          Override the default assistant instructions. Empty uses the built-in trading-platform prompt.
        </p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          disabled={!canEdit}
          rows={12}
          placeholder={DEFAULT_SYSTEM_PROMPT_PLACEHOLDER}
          className="mt-4 flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-70 font-mono"
        />
      </Card>

      <Card className="p-6">
        <AiTestSection
          canEdit={canEdit}
          apiKeyConfigured={config.apiKeyConfigured}
          testPending={testMutation.isPending}
          onTest={() => testMutation.mutate()}
          testReply={testReply}
        />
      </Card>

      {canEdit && (
        <AiSaveActions
          onReset={handleReset}
          onSave={() => saveMutation.mutate()}
          savePending={saveMutation.isPending}
          fetchPending={query.isFetching}
        />
      )}
    </div>
  )
}

function AiLoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading AI settings…
    </div>
  )
}

function AiSettingsHeader({ config }: { config: AiConfigDto }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-surface-2 p-2 text-accent">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-text">AI Assistant</h3>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            Configure the Anthropic-powered assistant shown in the terminal chat panel. The API key is stored
            server-side and is never returned to the browser after saving.
          </p>
        </div>
      </div>
      <AiKeyBadge configured={config.apiKeyConfigured} />
    </div>
  )
}

function AiKeyBadge({ configured }: { configured: boolean }) {
  return (
    <div
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
        configured
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-border bg-surface-2 text-text-muted'
      }`}
    >
      {configured ? 'API key configured' : 'No API key'}
    </div>
  )
}

function AiEnableRow({
  enabled,
  setEnabled,
  canEdit,
}: {
  enabled: boolean
  setEnabled: (v: boolean) => void
  canEdit: boolean
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 rounded-md border border-border bg-surface-1 p-3">
      <div>
        <p className="text-sm font-medium text-text">Enable AI chat</p>
        <p className="text-xs text-text-muted">When disabled, traders cannot send messages to the AI assistant.</p>
      </div>
      <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
    </div>
  )
}

function AiModelRows({
  provider,
  setProvider,
  model,
  setModel,
  classifierModel,
  setClassifierModel,
  canEdit,
}: {
  provider: string
  setProvider: (v: string) => void
  model: string
  setModel: (v: string) => void
  classifierModel: string
  setClassifierModel: (v: string) => void
  canEdit: boolean
}) {
  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-2">
      <AiProviderSelect provider={provider} setProvider={setProvider} canEdit={canEdit} />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text">Chat model</label>
        <Select value={model} onValueChange={setModel} disabled={!canEdit}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHAT_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text">Classifier model (topic guard)</label>
        <Select value={classifierModel} onValueChange={setClassifierModel} disabled={!canEdit}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (recommended)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function AiProviderSelect({
  provider,
  setProvider,
  canEdit,
}: {
  provider: string
  setProvider: (v: string) => void
  canEdit: boolean
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">Provider</label>
      <Select value={provider} onValueChange={setProvider} disabled={!canEdit}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="anthropic">Anthropic</SelectItem>
          <SelectItem value="openai" disabled>
            OpenAI (Coming soon)
          </SelectItem>
          <SelectItem value="gemini" disabled>
            Google Gemini (Coming soon)
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function AiApiKeySection({
  config,
  canEdit,
  apiKeyInput,
  setApiKeyInput,
  showApiKey,
  setShowApiKey,
  clearApiKeyPending,
  setClearApiKeyPending,
  savePending,
}: {
  config: AiConfigDto
  canEdit: boolean
  apiKeyInput: string
  setApiKeyInput: (v: string) => void
  showApiKey: boolean
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>
  clearApiKeyPending: boolean
  setClearApiKeyPending: (v: boolean) => void
  savePending: boolean
}) {
  return (
    <div className="mt-6 space-y-3">
      <label className="block text-sm font-medium text-text" htmlFor="ai-api-key-input">
        Anthropic API key
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="relative min-w-0 flex-1">
          <Input
            id="ai-api-key-input"
            className="pr-10 font-mono text-sm"
            type={showApiKey ? 'text' : 'password'}
            autoComplete="new-password"
            value={apiKeyInput}
            onChange={(e) => {
              setApiKeyInput(e.target.value)
              setClearApiKeyPending(false)
            }}
            placeholder={
              config.apiKeyConfigured ? 'Enter a new key to replace the current key' : 'Paste Anthropic API key'
            }
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
            disabled={savePending}
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
        Leave blank to keep the current key. If no stored key exists, the backend can use{' '}
        <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.7rem]">ANTHROPIC_API_KEY</code> from the server
        environment.
      </p>
      {config.envApiKeyConfigured && !config.storedApiKeyConfigured && (
        <p className="text-xs text-warning">
          An environment API key is currently configured. Saving a key here will use the stored key for chat.
        </p>
      )}
      {clearApiKeyPending && (
        <p className="text-xs text-warning">Removal pending—click “Save AI settings” to apply.</p>
      )}
    </div>
  )
}

function AiLimitsSection({
  canEdit,
  topicGuardEnabled,
  setTopicGuardEnabled,
  includeUserContext,
  setIncludeUserContext,
  maxTokensPerMessage,
  setMaxTokensPerMessage,
  dailyTokenCapPerUser,
  setDailyTokenCapPerUser,
  rateLimitPerMinute,
  setRateLimitPerMinute,
}: {
  canEdit: boolean
  topicGuardEnabled: boolean
  setTopicGuardEnabled: (v: boolean) => void
  includeUserContext: boolean
  setIncludeUserContext: (v: boolean) => void
  maxTokensPerMessage: string
  setMaxTokensPerMessage: (v: string) => void
  dailyTokenCapPerUser: string
  setDailyTokenCapPerUser: (v: string) => void
  rateLimitPerMinute: string
  setRateLimitPerMinute: (v: string) => void
}) {
  return (
    <div className="mt-6 space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-1 p-3">
        <div>
          <p className="text-sm font-medium text-text">Topic guard</p>
          <p className="text-xs text-text-muted">Block off-topic questions before the main model runs.</p>
        </div>
        <Switch checked={topicGuardEnabled} onCheckedChange={setTopicGuardEnabled} disabled={!canEdit} />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-1 p-3">
        <div>
          <p className="text-sm font-medium text-text">Include user context</p>
          <p className="text-xs text-text-muted">
            Inject read-only account, positions, and orders into the system prompt.
          </p>
        </div>
        <Switch checked={includeUserContext} onCheckedChange={setIncludeUserContext} disabled={!canEdit} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text">Max tokens per message</label>
          <Input
            type="number"
            min={256}
            max={8192}
            value={maxTokensPerMessage}
            onChange={(e) => setMaxTokensPerMessage(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text">Daily token cap per user</label>
          <Input
            type="number"
            min={1000}
            max={500000}
            value={dailyTokenCapPerUser}
            onChange={(e) => setDailyTokenCapPerUser(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <AiRateLimitField
          rateLimitPerMinute={rateLimitPerMinute}
          setRateLimitPerMinute={setRateLimitPerMinute}
          canEdit={canEdit}
        />
      </div>
    </div>
  )
}

function AiRateLimitField({
  rateLimitPerMinute,
  setRateLimitPerMinute,
  canEdit,
}: {
  rateLimitPerMinute: string
  setRateLimitPerMinute: (v: string) => void
  canEdit: boolean
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">Rate limit per minute</label>
      <Input
        type="number"
        min={1}
        max={60}
        value={rateLimitPerMinute}
        onChange={(e) => setRateLimitPerMinute(e.target.value)}
        disabled={!canEdit}
      />
    </div>
  )
}

function AiTestSection({
  canEdit,
  apiKeyConfigured,
  testPending,
  onTest,
  testReply,
}: {
  canEdit: boolean
  apiKeyConfigured: boolean
  testPending: boolean
  onTest: () => void
  testReply: string | null
}) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-surface-2 p-2 text-accent">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-text">Test connection</h3>
            <p className="mt-1 text-sm text-text-muted">
              Sends a short test message to Anthropic using the saved configuration (or environment key).
            </p>
          </div>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testPending || !apiKeyConfigured}
          >
            {testPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing…
              </>
            ) : (
              'Test connection'
            )}
          </Button>
        )}
      </div>
      {testReply && (
        <div className="mt-4 rounded-md border border-border bg-surface-1 p-3 text-sm text-text whitespace-pre-wrap">
          {testReply}
        </div>
      )}
    </>
  )
}

function AiSaveActions({
  onReset,
  onSave,
  savePending,
  fetchPending,
}: {
  onReset: () => void
  onSave: () => void
  savePending: boolean
  fetchPending: boolean
}) {
  return (
    <div className="flex justify-end gap-3">
      <Button type="button" variant="outline" onClick={onReset} disabled={savePending || fetchPending}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Reset
      </Button>
      <Button type="button" onClick={onSave} disabled={savePending}>
        {savePending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            Save AI settings
          </>
        )}
      </Button>
    </div>
  )
}
