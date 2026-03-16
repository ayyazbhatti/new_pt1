import { http } from '@/shared/api/http'

export interface SystemStatsDisk {
  mount: string
  size: number
  used: number
  avail: number
  usePct: number
}

export interface SystemStatsMemory {
  totalMb: number
  usedMb: number
  availMb: number
  usePct: number
}

export interface SystemStatsContainer {
  name: string
  state: string
  status: string
}

export interface SystemStatsContainerStat {
  name: string
  cpuPerc: string
  memUsage: string
}

export interface SystemStats {
  timestamp: string
  uptimeSeconds: number
  /** Host CPU usage % (1-second average), or null if unavailable */
  cpuUsePct: number | null
  disk: SystemStatsDisk
  volume: SystemStatsDisk | null
  memory: SystemStatsMemory
  containers: SystemStatsContainer[]
  containerStats: SystemStatsContainerStat[]
}

export async function fetchSystemStats(): Promise<SystemStats> {
  return http<SystemStats>('/api/admin/system/stats')
}
