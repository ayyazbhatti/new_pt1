import { useState, useCallback, useEffect } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui'
import { Card } from '@/shared/ui/card'
import { fetchSystemStats, type SystemStats } from '../api/system.api'
import { getApiErrorMessage } from '@/shared/api/http'
import { RefreshCw, HardDrive, Cpu, MemoryStick, Server, Loader2 } from 'lucide-react'

function formatBytes(n: number): string {
  const g = 1e9
  const m = 1e6
  if (n >= g) return `${(n / g).toFixed(1)} GB`
  if (n >= m) return `${(n / m).toFixed(0)} MB`
  return `${n} B`
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchSystemStats()
      setStats(data)
    } catch (e) {
      setError(getApiErrorMessage(e))
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <ContentShell>
      <PageHeader
        title="System"
        description="Server and container stats (refreshed on demand)"
      />
      <div className="flex items-center gap-3 mb-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
        {stats?.timestamp && (
          <span className="text-xs text-text-muted">
            Last updated: {new Date(stats.timestamp).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {loading && !stats && (
        <div className="flex items-center gap-2 text-text-muted py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading stats…
        </div>
      )}

      {!loading && stats && (
        <div className="space-y-6">
          {/* Overview cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <Server className="h-4 w-4" />
                <span className="text-sm font-medium">Uptime</span>
              </div>
              <p className="text-lg font-semibold text-text">{formatUptime(stats.uptimeSeconds)}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <Cpu className="h-4 w-4" />
                <span className="text-sm font-medium">Host CPU</span>
              </div>
              <p className="text-lg font-semibold text-text">
                {stats.cpuUsePct != null ? `${stats.cpuUsePct}%` : '—'}
              </p>
              {stats.cpuUsePct != null && (
                <p className="text-xs text-text-muted mt-0.5">1s average at collection time</p>
              )}
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <HardDrive className="h-4 w-4" />
                <span className="text-sm font-medium">Root disk</span>
              </div>
              <p className="text-lg font-semibold text-text">
                {stats.disk?.usePct != null ? `${stats.disk.usePct.toFixed(1)}%` : '—'} used
              </p>
              {stats.disk && (
                <p className="text-xs text-text-muted mt-0.5">
                  {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.size)} · {formatBytes(stats.disk.avail)} free
                </p>
              )}
            </Card>
            {stats.volume && (
              <Card className="p-4">
                <div className="flex items-center gap-2 text-text-muted mb-2">
                  <HardDrive className="h-4 w-4" />
                  <span className="text-sm font-medium">Volume</span>
                </div>
                <p className="text-lg font-semibold text-text">
                  {stats.volume.usePct.toFixed(1)}% used
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {formatBytes(stats.volume.used)} / {formatBytes(stats.volume.size)} · {formatBytes(stats.volume.avail)} free
                </p>
              </Card>
            )}
            <Card className="p-4">
              <div className="flex items-center gap-2 text-text-muted mb-2">
                <MemoryStick className="h-4 w-4" />
                <span className="text-sm font-medium">Memory</span>
              </div>
              <p className="text-lg font-semibold text-text">
                {stats.memory?.usePct != null ? `${stats.memory.usePct.toFixed(1)}%` : '—'} used
              </p>
              {stats.memory && (
                <p className="text-xs text-text-muted mt-0.5">
                  {stats.memory.usedMb} MB / {stats.memory.totalMb} MB · {stats.memory.availMb} MB free
                </p>
              )}
            </Card>
          </div>

          {/* Containers */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Cpu className="h-4 w-4 text-text-muted" />
              <h2 className="text-sm font-semibold text-text">Containers</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">CPU</th>
                    <th className="px-4 py-2 font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.containers?.map((c) => {
                    const stat = stats.containerStats?.find((s) => s.name === c.name)
                    return (
                      <tr key={c.name} className="border-b border-border/50 hover:bg-white/5">
                        <td className="px-4 py-2 font-mono text-text">{c.name}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              c.state === 'running'
                                ? 'text-emerald-500'
                                : 'text-amber-500'
                            }
                          >
                            {c.state}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-text-muted">{c.status}</td>
                        <td className="px-4 py-2 text-text-muted">{stat?.cpuPerc ?? '—'}</td>
                        <td className="px-4 py-2 text-text-muted">{stat?.memUsage ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {(!stats.containers || stats.containers.length === 0) && (
              <p className="px-4 py-6 text-sm text-text-muted text-center">No container data</p>
            )}
          </Card>
        </div>
      )}

      {!loading && !stats && !error && (
        <p className="text-text-muted text-sm">No stats available.</p>
      )}
    </ContentShell>
  )
}
