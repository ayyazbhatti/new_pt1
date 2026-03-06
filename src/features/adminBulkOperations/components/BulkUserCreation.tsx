import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGroupsList } from '@/features/groups/hooks/useGroups'
import {
  Settings,
  DollarSign,
  Users,
  Loader2,
  Download,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
} from 'lucide-react'
import { toast } from '@/shared/components/common'
import { getBulkConfig, createBulkUsers } from '../api/bulk.api'
import type { BulkUserCreationConfig, BulkUserCreationResult } from '../types'

const inputClasses =
  'w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent'
const labelClasses = 'block text-sm font-medium text-text mb-2'
const helperClasses = 'mt-1 text-xs text-text-muted'

const defaultConfig: BulkUserCreationConfig = {
  count: 0,
  usernamePrefix: '',
  emailDomain: '',
  password: '',
  firstNamePrefix: 'User',
  lastName: 'Test',
  startingNumber: 1,
  groupId: '',
  accountMode: 'hedging',
  initialBalanceEnabled: false,
  initialBalanceAmount: 0,
  initialBalanceFee: 0,
  initialBalanceReference: '',
}

export function BulkUserCreation() {
  const [config, setConfig] = useState<BulkUserCreationConfig>(defaultConfig)
  const [showPassword, setShowPassword] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [results, setResults] = useState<BulkUserCreationResult[]>([])

  const { data: serverConfig, isLoading: configLoading } = useQuery({
    queryKey: ['bulk-config'],
    queryFn: getBulkConfig,
    staleTime: 5 * 60 * 1000,
  })
  const bulkConfig = serverConfig?.bulk_user_creation
  const maxUsers = bulkConfig?.max_users_per_run ?? 100_000

  const { data: groupsData, isLoading: groupsLoading } = useGroupsList({
    page_size: 100,
  })
  const groups = groupsData?.items ?? []

  useEffect(() => {
    if (!bulkConfig?.defaults) return
    setConfig((prev) => ({
      ...prev,
      firstNamePrefix: prev.firstNamePrefix || bulkConfig.defaults.first_name_prefix,
      lastName: prev.lastName || bulkConfig.defaults.last_name,
      startingNumber: prev.startingNumber ?? bulkConfig.defaults.starting_number,
      accountMode: (prev.accountMode || bulkConfig.defaults.account_mode) as 'netting' | 'hedging',
    }))
  }, [bulkConfig?.defaults?.first_name_prefix, bulkConfig?.defaults?.last_name, bulkConfig?.defaults?.starting_number, bulkConfig?.defaults?.account_mode])

  const update = useCallback(<K extends keyof BulkUserCreationConfig>(
    key: K,
    value: BulkUserCreationConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  const count = Math.max(0, Number(config.count) || 0)

  const previewUsers = useMemo(() => {
    if (count <= 0 || count > 10) return []
    const n = Math.min(count, 5)
    const start = config.startingNumber
    const un = (config.usernamePrefix || 'user').trim()
    const domain = (config.emailDomain || 'example.com').trim()
    const fn = (config.firstNamePrefix || 'User').trim()
    const ln = (config.lastName || 'Test').trim()
    return Array.from({ length: n }, (_, i) => {
      const num = start + i
      const username = `${un}${String(num).padStart(3, '0')}`
      const email = `${username}@${domain}`
      return { username, email, firstName: `${fn}${num}`, lastName: ln }
    })
  }, [count, config.usernamePrefix, config.emailDomain, config.firstNamePrefix, config.lastName, config.startingNumber])

  const validate = useCallback((): boolean => {
    if (count <= 0) {
      toast.error('Please enter a valid number of users to create')
      return false
    }
    if (count > maxUsers) {
      toast.error(`Maximum ${maxUsers.toLocaleString()} users can be created at once`)
      return false
    }
    if (!(config.usernamePrefix || '').trim()) {
      toast.error('Username prefix is required')
      return false
    }
    if (!(config.emailDomain || '').trim()) {
      toast.error('Email domain is required')
      return false
    }
    if ((config.password || '').length < 8) {
      toast.error('Password must be at least 8 characters')
      return false
    }
    if (!config.password.match(/\d/)) {
      toast.error('Password must contain at least one number')
      return false
    }
    if (config.initialBalanceEnabled) {
      const amt = Number(config.initialBalanceAmount)
      if (amt <= 0) {
        toast.error('Initial balance amount must be greater than 0')
        return false
      }
      const fee = Number(config.initialBalanceFee) || 0
      if (fee > amt) {
        toast.error('Fee cannot exceed amount')
        return false
      }
    }
    return true
  }, [count, config, maxUsers])

  const handleCreate = useCallback(async () => {
    if (!validate()) return
    setIsProcessing(true)
    setResults([])
    try {
      const payload = {
        count,
        username_prefix: (config.usernamePrefix || '').trim(),
        email_domain: (config.emailDomain || '').trim(),
        password: config.password,
        first_name_prefix: (config.firstNamePrefix || '').trim() || undefined,
        last_name: (config.lastName || '').trim() || undefined,
        starting_number: config.startingNumber,
        group_id: config.groupId || null,
        account_mode: config.accountMode,
        initial_balance_enabled: config.initialBalanceEnabled,
        initial_balance_amount: config.initialBalanceEnabled ? Number(config.initialBalanceAmount) || null : null,
        initial_balance_fee: config.initialBalanceEnabled ? Number(config.initialBalanceFee) || null : null,
        initial_balance_reference: (config.initialBalanceReference || '').trim() || null,
      }
      const res = await createBulkUsers(payload)
      const mapped: BulkUserCreationResult[] = res.results.map((r) => ({
        username: r.username,
        email: r.email,
        success: r.success,
        userId: r.user_id ?? undefined,
        accountId: r.account_id ?? undefined,
        error: r.error ?? undefined,
      }))
      setResults(mapped)
      toast.success(
        `Bulk user creation completed. ${res.success_count} succeeded, ${res.failed_count} failed.`
      )
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : err instanceof Error ? err.message : 'Bulk create failed'
      toast.error(msg || 'Bulk create failed')
    } finally {
      setIsProcessing(false)
    }
  }, [count, config, validate])

  const handleDownload = useCallback(() => {
    if (results.length === 0) return
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const header = 'username,email,success,userId,accountId,error'
    const rows = results.map(
      (r) =>
        `${r.username},${r.email},${r.success ? 'success' : 'failed'},${r.userId ?? ''},${r.accountId ?? ''},${(r.error ?? '').replace(/,/g, ';')}`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bulk_users_results_${timestamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [results])

  const displayResults = results.slice(0, 100)
  const hasMoreResults = results.length > 100

  if (configLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text mb-1">Bulk User Creation</h2>
          <p className="text-sm text-text-muted">Loading configuration…</p>
        </div>
      </div>
    )
  }

  if (serverConfig && !bulkConfig?.enabled) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text mb-1">Bulk User Creation</h2>
          <p className="text-sm text-text-muted">Bulk user creation is not available.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text mb-1">Bulk User Creation</h2>
        <p className="text-sm text-text-muted">
          Create multiple users automatically by entering the number of users to create
        </p>
      </div>

      {/* Configuration card */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Settings className="w-5 h-5 text-text-muted" />
          <span className="text-lg font-semibold text-text">Configuration</span>
        </div>
        <div className="mb-4">
          <label className={labelClasses}>Number of Users to Create *</label>
          <input
            type="number"
            min={1}
            max={maxUsers}
            placeholder="e.g., 100, 10000, 100000"
            className={inputClasses}
            value={config.count || ''}
            onChange={(e) => update('count', e.target.value ? parseInt(e.target.value, 10) : 0)}
            disabled={configLoading}
          />
          <p className={helperClasses}>
            Enter the number of users you want to create (max: {maxUsers.toLocaleString()})
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClasses}>Username Prefix *</label>
            <input
              type="text"
              placeholder="user"
              className={inputClasses}
              value={config.usernamePrefix}
              onChange={(e) => update('usernamePrefix', e.target.value)}
            />
            <p className={helperClasses}>
              Users will be: {config.usernamePrefix || '{prefix}'}001, {config.usernamePrefix || '{prefix}'}002, etc.
            </p>
          </div>
          <div>
            <label className={labelClasses}>Email Domain *</label>
            <input
              type="text"
              placeholder="example.com"
              className={inputClasses}
              value={config.emailDomain}
              onChange={(e) => update('emailDomain', e.target.value)}
            />
            <p className={helperClasses}>
              Emails will be: {config.usernamePrefix || '{prefix}'}001@{config.emailDomain || '{domain}'}, etc.
            </p>
          </div>
          <div>
            <label className={labelClasses}>Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password123!"
                className={inputClasses}
                value={config.password}
                onChange={(e) => update('password', e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className={helperClasses}>Same password for all users (min: 8 characters)</p>
          </div>
          <div>
            <label className={labelClasses}>First Name Prefix</label>
            <input
              type="text"
              placeholder="User"
              className={inputClasses}
              value={config.firstNamePrefix}
              onChange={(e) => update('firstNamePrefix', e.target.value)}
            />
            <p className={helperClasses}>
              First names will be: {config.firstNamePrefix || '{prefix}'}1, {config.firstNamePrefix || '{prefix}'}2, etc.
            </p>
          </div>
          <div>
            <label className={labelClasses}>Last Name</label>
            <input
              type="text"
              placeholder="Test"
              className={inputClasses}
              value={config.lastName}
              onChange={(e) => update('lastName', e.target.value)}
            />
            <p className={helperClasses}>Same last name for all users</p>
          </div>
          <div>
            <label className={labelClasses}>Starting Number</label>
            <input
              type="number"
              min={1}
              className={inputClasses}
              value={config.startingNumber || ''}
              onChange={(e) =>
                update('startingNumber', e.target.value ? parseInt(e.target.value, 10) : 1)
              }
            />
            <p className={helperClasses}>Number to start from (default: 1)</p>
          </div>
          <div>
            <label className={labelClasses}>Group (Optional)</label>
            <select
              className={inputClasses}
              value={config.groupId || '__none__'}
              onChange={(e) =>
                update('groupId', e.target.value === '__none__' ? '' : e.target.value)
              }
              disabled={groupsLoading}
            >
              <option value="__none__">No Group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Account Mode</label>
            <select
              className={inputClasses}
              value={config.accountMode}
              onChange={(e) =>
                update('accountMode', e.target.value as 'netting' | 'hedging')
              }
            >
              <option value="netting">Netting</option>
              <option value="hedging">Hedging</option>
            </select>
          </div>
        </div>

        {/* Initial Balance (optional) */}
        <div className="mt-6 pt-6 border-t border-border">
          <div className="flex items-center space-x-2 mb-4">
            <DollarSign className="w-5 h-5 text-text-muted" />
            <span className="text-lg font-semibold text-text">
              Initial Balance (Optional)
            </span>
          </div>
          <label className="flex items-center space-x-2 cursor-pointer mb-4">
            <input
              type="checkbox"
              className="w-4 h-4 text-accent bg-surface-2 border-border rounded focus:ring-accent"
              checked={config.initialBalanceEnabled}
              onChange={(e) => update('initialBalanceEnabled', e.target.checked)}
            />
            <span className="text-sm font-medium text-text">
              Add initial balance to all users after creation
            </span>
          </label>
          {config.initialBalanceEnabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelClasses}>Amount (USD) *</label>
                <input
                  type="number"
                  step={0.01}
                  min={0.01}
                  placeholder="0.00"
                  className={inputClasses}
                  value={config.initialBalanceAmount || ''}
                  onChange={(e) =>
                    update(
                      'initialBalanceAmount',
                      e.target.value ? parseFloat(e.target.value) : 0
                    )
                  }
                />
              </div>
              <div>
                <label className={labelClasses}>Fee (USD)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  placeholder="0.00"
                  className={inputClasses}
                  value={config.initialBalanceFee || ''}
                  onChange={(e) =>
                    update(
                      'initialBalanceFee',
                      e.target.value ? parseFloat(e.target.value) : 0
                    )
                  }
                />
              </div>
              <div>
                <label className={labelClasses}>Reference</label>
                <input
                  type="text"
                  placeholder="Optional reference"
                  className={inputClasses}
                  value={config.initialBalanceReference}
                  onChange={(e) => update('initialBalanceReference', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview (when count 1–10) */}
      {count > 0 && count <= 10 && previewUsers.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text mb-2">
            Preview (first {previewUsers.length} users):
          </p>
          <div className="space-y-1 text-xs text-text-muted">
            {previewUsers.map((u, i) => (
              <div key={i} className="flex space-x-4">
                <span className="w-32">{u.username}</span>
                <span className="flex-1">{u.email}</span>
                <span>
                  {u.firstName} {u.lastName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create button */}
      <div className="mt-6">
        <button
          type="button"
          disabled={isProcessing || count <= 0 || configLoading}
          onClick={() => void handleCreate()}
          className="flex items-center space-x-2 px-6 py-3 rounded-lg text-sm font-medium transition-colors w-full md:w-auto bg-success hover:bg-success/90 disabled:bg-surface-2 disabled:cursor-not-allowed text-white"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Creating users…</span>
            </>
          ) : (
            <>
              <Users className="w-5 h-5" />
              <span>Create {count} Users</span>
            </>
          )}
        </button>
      </div>

      {/* Results section */}
      {results.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text">
              Results (
              {results.filter((r) => r.success).length} succeeded,{' '}
              {results.filter((r) => !r.success).length} failed)
            </h3>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-surface-2 hover:bg-surface border border-border text-text"
            >
              <Download className="w-4 h-4" />
              <span>Download Results</span>
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {displayResults.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  r.success
                    ? 'bg-success/10 border border-success/50'
                    : 'bg-danger/10 border border-danger/50'
                }`}
              >
                <div className="flex items-center flex-1 gap-3">
                  {r.success ? (
                    <CheckCircle className="w-5 h-5 text-success shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-danger shrink-0" />
                  )}
                  <div className="flex-1 grid grid-cols-3 gap-4 text-sm min-w-0">
                    <span className="text-text-muted">
                      Username: <span className="ml-2 text-text">{r.username}</span>
                    </span>
                    <span className="text-text-muted">
                      Email: <span className="ml-2 text-text">{r.email}</span>
                    </span>
                    {r.success ? (
                      <span className="text-text-muted">
                        User ID:{' '}
                        <span className="ml-2 text-text font-mono text-xs">
                          {r.userId ?? '—'}
                        </span>
                      </span>
                    ) : (
                      <span className="text-text-muted">
                        Error: <span className="ml-2 text-danger">{r.error ?? '—'}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hasMoreResults && (
            <p className="text-text-muted text-sm py-2 text-center">
              Showing first 100 results. Download full results for complete list.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
