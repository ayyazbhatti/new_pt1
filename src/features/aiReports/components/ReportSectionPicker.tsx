import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ClipboardList,
  FileCheck,
  History,
  LineChart,
  Shield,
  TrendingUp,
  User,
  Users,
  Wallet,
} from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '@/shared/utils'
import { Checkbox } from '@/shared/ui/Checkbox'
import {
  AI_REPORT_SECTIONS,
  type AiReportSection,
} from '../api/aiReports.api'

export type ReportSection = AiReportSection

const FOCUS_MAX = 500

const SECTION_META: {
  id: AiReportSection
  label: string
  description: string
  icon: LucideIcon
  locked?: boolean
}[] = [
  {
    id: 'profile',
    label: 'Profile & account',
    description: 'Identity, group, KYC snapshot',
    icon: User,
    locked: true,
  },
  {
    id: 'trading_performance',
    label: 'Trading performance',
    description: 'PnL, win rate, volume',
    icon: TrendingUp,
  },
  {
    id: 'open_positions',
    label: 'Open positions',
    description: 'Live positions from Redis',
    icon: LineChart,
  },
  {
    id: 'closed_trades',
    label: 'Closed trades',
    description: 'Recent closed positions',
    icon: History,
  },
  {
    id: 'financial_activity',
    label: 'Financial activity',
    description: 'Deposits, withdrawals, adjustments',
    icon: Wallet,
  },
  {
    id: 'risk_profile',
    label: 'Risk profile',
    description: 'Leverage, margin, group limits',
    icon: Shield,
  },
  {
    id: 'kyc',
    label: 'KYC',
    description: 'Submission history',
    icon: FileCheck,
  },
  {
    id: 'engagement',
    label: 'Engagement',
    description: 'Logins and activity signals',
    icon: Activity,
  },
  {
    id: 'affiliate',
    label: 'Affiliate',
    description: 'Referral and commission data',
    icon: Users,
  },
  {
    id: 'admin_activity',
    label: 'Admin activity',
    description: 'Notes and admin actions',
    icon: ClipboardList,
  },
]

const OPTIONAL_SECTIONS = SECTION_META.filter((s) => s.id !== 'profile').map((s) => s.id)

export interface ReportSectionPickerProps {
  value: ReportSection[]
  focus: string
  onChange: (sections: ReportSection[]) => void
  onFocusChange: (focus: string) => void
  disabled?: boolean
}

function withProfile(sections: ReportSection[]): ReportSection[] {
  const set = new Set<ReportSection>(sections)
  set.add('profile')
  return AI_REPORT_SECTIONS.filter((id) => set.has(id))
}

export function ReportSectionPicker({
  value,
  focus,
  onChange,
  onFocusChange,
  disabled,
}: ReportSectionPickerProps) {
  const selected = withProfile(value)
  const focusLen = focus.length

  const optionalSelectedCount = useMemo(
    () => OPTIONAL_SECTIONS.filter((id) => selected.includes(id)).length,
    [selected],
  )
  const allOptionalSelected =
    OPTIONAL_SECTIONS.length > 0 && optionalSelectedCount === OPTIONAL_SECTIONS.length
  const someOptionalSelected =
    optionalSelectedCount > 0 && optionalSelectedCount < OPTIONAL_SECTIONS.length

  const toggleSelectAllOptional = () => {
    if (disabled) return
    if (allOptionalSelected) {
      onChange(['profile'])
    } else {
      onChange([...AI_REPORT_SECTIONS])
    }
  }

  const toggle = (id: AiReportSection, checked: boolean) => {
    if (id === 'profile') return
    const set = new Set(selected)
    if (checked) set.add(id)
    else set.delete(id)
    onChange(withProfile([...set]))
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text">Report sections</span>
          <label
            className={cn(
              'flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <Checkbox
              checked={allOptionalSelected}
              indeterminate={someOptionalSelected}
              disabled={disabled}
              onChange={toggleSelectAllOptional}
              aria-label="Select all optional sections"
            />
            Select all
          </label>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Profile is always included. Select at least one additional section.
        </p>
        <ul className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1 scrollbar-modal">
          {SECTION_META.map(({ id, label, description, icon: Icon, locked }) => {
            const checked = selected.includes(id)
            return (
              <li
                key={id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2.5',
                  disabled && 'opacity-60',
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled || locked}
                  onChange={(e) => toggle(id, e.target.checked)}
                  aria-label={label}
                  className="mt-0.5"
                />
                <Icon className="h-4 w-4 shrink-0 text-text-muted mt-0.5" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">{label}</p>
                  <p className="text-xs text-text-muted mt-0.5">{description}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <label htmlFor="report-focus" className="text-sm font-medium text-text mb-2 block">
          Additional focus (optional)
        </label>
        <textarea
          id="report-focus"
          rows={4}
          value={focus}
          disabled={disabled}
          maxLength={FOCUS_MAX}
          placeholder="e.g. focus on margin usage and recent deposit patterns"
          className="flex min-h-[80px] w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none"
          onChange={(e) => onFocusChange(e.target.value.slice(0, FOCUS_MAX))}
        />
        <p className="text-xs text-text-muted mt-1">
          {focusLen} / {FOCUS_MAX}
        </p>
      </div>
    </div>
  )
}
