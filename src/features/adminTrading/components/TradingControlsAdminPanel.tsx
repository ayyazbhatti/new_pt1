import { useState } from 'react'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { DataTable } from '@/shared/ui/table'
import { ColumnDef } from '@tanstack/react-table'
import { SymbolControl, GroupControl, AuditLogEntry } from '../types/adminTrading'
import { mockSymbolControls, mockGroupControls, mockAuditLog } from '../mocks/tradingControls.mock'
import { mockGroups } from '../mocks/groups.mock'
import { mockSymbols } from '../mocks/symbols.mock'
import { toast } from '@/shared/components/common'
import { formatDateTime } from '../utils/formatters'

export function TradingControlsAdminPanel() {
  const [symbolControls, setSymbolControls] = useState<SymbolControl[]>(mockSymbolControls)
  const [groupControls, setGroupControls] = useState<GroupControl[]>(mockGroupControls)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(mockAuditLog)
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')

  const selectedSymbolControl = symbolControls.find((sc) => sc.symbol === selectedSymbol)
  const selectedGroupControl = groupControls.find((gc) => gc.groupId === selectedGroup)

  const handleSaveSymbolControl = () => {
    if (!selectedSymbol) {
      toast.error('Please select a symbol')
      return
    }
    toast.success(`Symbol controls saved for ${selectedSymbol}`)
    setAuditLog([
      {
        id: `AUD-${Date.now()}`,
        time: new Date().toISOString(),
        admin: 'admin@broker.com',
        action: 'Updated symbol control',
        target: `${selectedSymbol}`,
      },
      ...auditLog,
    ])
  }

  const handleResetSymbolControl = () => {
    if (!selectedSymbol) return
    const original = mockSymbolControls.find((sc) => sc.symbol === selectedSymbol)
    if (original) {
      setSymbolControls(
        symbolControls.map((sc) => (sc.symbol === selectedSymbol ? original : sc))
      )
      toast.success('Symbol controls reset')
    }
  }

  const handleSaveGroupControl = () => {
    if (!selectedGroup) {
      toast.error('Please select a group')
      return
    }
    toast.success(`Group controls saved for ${selectedGroup}`)
    setAuditLog([
      {
        id: `AUD-${Date.now()}`,
        time: new Date().toISOString(),
        admin: 'admin@broker.com',
        action: 'Updated group control',
        target: selectedGroupControl?.groupName || selectedGroup,
      },
      ...auditLog,
    ])
  }

  const handleResetGroupControl = () => {
    if (!selectedGroup) return
    const original = mockGroupControls.find((gc) => gc.groupId === selectedGroup)
    if (original) {
      setGroupControls(
        groupControls.map((gc) => (gc.groupId === selectedGroup ? original : gc))
      )
      toast.success('Group controls reset')
    }
  }

  const updateSymbolControl = (field: keyof SymbolControl, value: any) => {
    if (!selectedSymbol) return
    setSymbolControls(
      symbolControls.map((sc) =>
        sc.symbol === selectedSymbol ? { ...sc, [field]: value } : sc
      )
    )
  }

  const updateGroupControl = (field: keyof GroupControl, value: any) => {
    if (!selectedGroup) return
    setGroupControls(
      groupControls.map((gc) =>
        gc.groupId === selectedGroup ? { ...gc, [field]: value } : gc
      )
    )
  }

  const auditColumns: ColumnDef<AuditLogEntry>[] = [
    {
      accessorKey: 'time',
      header: 'Time',
      cell: ({ row }) => formatDateTime(row.getValue('time')),
    },
    {
      accessorKey: 'admin',
      header: 'Admin',
    },
    {
      accessorKey: 'action',
      header: 'Action',
    },
    {
      accessorKey: 'target',
      header: 'Target',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 bg-surface-2">
          <div className="text-lg font-semibold text-text mb-4">Per Symbol Controls</div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Symbol</label>
              <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                <SelectTrigger>
                  <SelectValue placeholder="Select symbol" />
                </SelectTrigger>
                <SelectContent>
                  {mockSymbols.map((s) => (
                    <SelectItem key={s.id} value={s.code}>
                      {s.code} - {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedSymbolControl && (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text">Trading Enabled</label>
                  <Switch
                    checked={selectedSymbolControl.tradingEnabled}
                    onCheckedChange={(checked) => updateSymbolControl('tradingEnabled', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text">Close Only</label>
                  <Switch
                    checked={selectedSymbolControl.closeOnly}
                    onCheckedChange={(checked) => updateSymbolControl('closeOnly', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text">Allow New Orders</label>
                  <Switch
                    checked={selectedSymbolControl.allowNewOrders}
                    onCheckedChange={(checked) => updateSymbolControl('allowNewOrders', checked)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text mb-2 block">Max Leverage Cap</label>
                  <Input
                    type="number"
                    value={selectedSymbolControl.maxLeverageCap}
                    onChange={(e) =>
                      updateSymbolControl('maxLeverageCap', parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text mb-2 block">Max Order Size</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={selectedSymbolControl.maxOrderSize}
                    onChange={(e) =>
                      updateSymbolControl('maxOrderSize', parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text mb-2 block">Max Position Size</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={selectedSymbolControl.maxPositionSize}
                    onChange={(e) =>
                      updateSymbolControl('maxPositionSize', parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button onClick={handleSaveSymbolControl} className="flex-1">
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={handleResetSymbolControl}>
                    Reset
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="p-6 bg-surface-2">
          <div className="text-lg font-semibold text-text mb-4">Per Group Controls</div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Group</label>
              <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                <SelectTrigger>
                  <SelectValue placeholder="Select group" />
                </SelectTrigger>
                <SelectContent>
                  {mockGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedGroupControl && (
              <>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text">Trading Enabled</label>
                  <Switch
                    checked={selectedGroupControl.tradingEnabled}
                    onCheckedChange={(checked) => updateGroupControl('tradingEnabled', checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-text">Close Only</label>
                  <Switch
                    checked={selectedGroupControl.closeOnly}
                    onCheckedChange={(checked) => updateGroupControl('closeOnly', checked)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text mb-2 block">Max Leverage (Min)</label>
                  <Input
                    type="number"
                    value={selectedGroupControl.maxLeverageMin}
                    onChange={(e) =>
                      updateGroupControl('maxLeverageMin', parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text mb-2 block">Max Leverage (Max)</label>
                  <Input
                    type="number"
                    value={selectedGroupControl.maxLeverageMax}
                    onChange={(e) =>
                      updateGroupControl('maxLeverageMax', parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text mb-2 block">
                    Max Open Positions per User
                  </label>
                  <Input
                    type="number"
                    value={selectedGroupControl.maxOpenPositionsPerUser}
                    onChange={(e) =>
                      updateGroupControl('maxOpenPositionsPerUser', parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button onClick={handleSaveGroupControl} className="flex-1">
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={handleResetGroupControl}>
                    Reset
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-6 bg-surface-2">
        <div className="text-lg font-semibold text-text mb-4">Audit Log</div>
        <DataTable data={auditLog} columns={auditColumns} />
      </Card>
    </div>
  )
}

