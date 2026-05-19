import { cn } from '@/shared/utils'
import { deviceClassLabel, type DeviceClass } from '../types'
import { Monitor, Smartphone, Tablet, Bot, HelpCircle } from 'lucide-react'

const ICONS: Record<DeviceClass, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  bot: Bot,
  unknown: HelpCircle,
}

interface DeviceBadgeProps {
  deviceClass: string
  deviceOs?: string | null
  deviceBrowser?: string | null
  className?: string
}

export function DeviceBadge({
  deviceClass,
  deviceOs,
  deviceBrowser,
  className,
}: DeviceBadgeProps) {
  const key = (deviceClass?.toLowerCase() ?? 'unknown') as DeviceClass
  const Icon = ICONS[key] ?? ICONS.unknown
  const label = deviceClassLabel(deviceClass)
  const detail = [deviceOs, deviceBrowser].filter(Boolean).join(' · ')

  return (
    <span className={cn('inline-flex flex-col gap-0.5', className)} title={detail || label}>
      <span className="inline-flex items-center gap-1.5 text-sm text-text">
        <Icon className="h-3.5 w-3.5 text-text-muted shrink-0" aria-hidden />
        <span className="capitalize">{label}</span>
      </span>
      {detail ? <span className="text-xs text-text-muted pl-5">{detail}</span> : null}
    </span>
  )
}
