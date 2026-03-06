import { useState } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { BulkUserCreation } from '../components/BulkUserCreation'
import { Users, DollarSign, TrendingUp } from 'lucide-react'

type TabId = 'users' | 'deposit' | 'positions'

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'users', label: 'Bulk User Creation', icon: Users },
  { id: 'deposit', label: 'Bulk Deposit', icon: DollarSign },
  { id: 'positions', label: 'Bulk Position Creation', icon: TrendingUp },
]

export function AdminBulkOperationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('users')

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
              onClick={() => setActiveTab(id)}
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
        {activeTab === 'deposit' && (
          <div className="py-8 text-center text-sm text-text-muted">
            Bulk Deposit — coming soon
          </div>
        )}
        {activeTab === 'positions' && (
          <div className="py-8 text-center text-sm text-text-muted">
            Bulk Position Creation — coming soon
          </div>
        )}
      </div>
    </ContentShell>
  )
}
