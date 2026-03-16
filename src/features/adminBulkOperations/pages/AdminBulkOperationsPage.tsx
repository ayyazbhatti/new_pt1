import { useState } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { BulkUserCreation, BulkDepositSection, BulkPositionSection } from '../components'
import { Users, DollarSign, TrendingUp } from 'lucide-react'

type TabId = 'users' | 'deposit' | 'positions'

const BULK_OPERATIONS_TAB_STORAGE_KEY = 'admin-bulk-operations-tab'

function getStoredTab(): TabId {
  if (typeof sessionStorage === 'undefined') return 'users'
  const stored = sessionStorage.getItem(BULK_OPERATIONS_TAB_STORAGE_KEY)
  if (stored === 'users' || stored === 'deposit' || stored === 'positions') return stored
  return 'users'
}

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'users', label: 'Bulk User Creation', icon: Users },
  { id: 'deposit', label: 'Bulk Deposit', icon: DollarSign },
  { id: 'positions', label: 'Bulk Position Creation', icon: TrendingUp },
]

export function AdminBulkOperationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>(getStoredTab)

  return (
    <ContentShell className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Bulk Operations"
        description="Perform bulk operations for users, deposits, and positions"
      />

      <div className="border-b border-border">
        <div className="flex space-x-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActiveTab(id)
                try {
                  sessionStorage.setItem(BULK_OPERATIONS_TAB_STORAGE_KEY, id)
                } catch {
                  // ignore
                }
              }}
              className={`flex items-center space-x-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                activeTab === id
                  ? 'text-accent border-accent'
                  : 'text-text-muted hover:text-text border-transparent hover:border-border'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-2 p-4 sm:p-6">
        {activeTab === 'users' && <BulkUserCreation />}
        {activeTab === 'deposit' && <BulkDepositSection />}
        {activeTab === 'positions' && <BulkPositionSection />}
      </div>
    </ContentShell>
  )
}
