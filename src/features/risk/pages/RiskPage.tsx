import { ContentShell, PageHeader } from '@/shared/layout'
import { ExposureSummaryCards } from '../components/ExposureSummaryCards'
import { Button } from '@/shared/ui/button'
import { useModalStore } from '@/app/store'
import { UserLeverageLimitsModal } from '../modals/UserLeverageLimitsModal'
import { RiskLimitsModal } from '../modals/RiskLimitsModal'
import { Shield, Users } from 'lucide-react'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'

export function RiskPage() {
  const openModal = useModalStore((state) => state.openModal)

  const handleOpenUserLeverage = () => {
    openModal('user-leverage-limits', <UserLeverageLimitsModal />, {
      title: 'Set User Leverage Limits',
      size: 'lg',
    })
  }

  const handleOpenRiskLimits = () => {
    openModal('risk-limits', <RiskLimitsModal />, {
      title: 'Configure Risk Limits',
      size: 'md',
    })
  }

  return (
    <ContentShell>
      <PageHeader
        title="Risk Management"
        description="Monitor and manage platform risk exposure"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleOpenRiskLimits}>
              <Shield className="h-4 w-4 mr-2" />
              Risk Limits
            </Button>
            <Button onClick={handleOpenUserLeverage}>
              <Users className="h-4 w-4 mr-2" />
              User Leverage Limits
            </Button>
          </div>
        }
      />
      <ExposureSummaryCards />
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-text mb-4">Global Leverage Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-muted mb-2 block">Min Leverage</label>
              <Input type="number" defaultValue="1" />
            </div>
            <div>
              <label className="text-sm font-medium text-text-muted mb-2 block">Max Leverage</label>
              <Input type="number" defaultValue="500" />
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-text mb-4">Risk Thresholds</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-muted mb-2 block">Warning Threshold (%)</label>
              <Input type="number" defaultValue="75" />
            </div>
            <div>
              <label className="text-sm font-medium text-text-muted mb-2 block">Critical Threshold (%)</label>
              <Input type="number" defaultValue="90" />
            </div>
          </div>
        </Card>
      </div>
    </ContentShell>
  )
}

