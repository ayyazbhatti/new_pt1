import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { SwapRule } from '../types/swap'
import { useModalStore } from '@/app/store'
import { computeSwapPreview } from '../utils/computeSwapPreview'
import { useAdminSymbolsList } from '@/features/symbols/hooks/useSymbols'
import { WifiOff } from 'lucide-react'

interface PreviewSwapModalProps {
  rule: SwapRule
}

export function PreviewSwapModal({ rule }: PreviewSwapModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const { data: symbolsData } = useAdminSymbolsList()
  const symbolInfo = (symbolsData?.items ?? []).find(
    (s) => s.symbolCode === rule.symbol
  )
  const quoteCurrency = symbolInfo?.quoteCurrency ?? 'USD'

  const [side, setSide] = useState<'long' | 'short'>('long')
  const [positionSize, setPositionSize] = useState(1)
  const [entryPrice, setEntryPrice] = useState(1000)
  const [currentPrice, setCurrentPrice] = useState(1010)
  const [leverage, setLeverage] = useState(100)
  const [holdingHours, setHoldingHours] = useState(24)

  const preview = computeSwapPreview(rule, {
    side,
    positionSize,
    entryPrice,
    currentPrice,
    leverage,
    holdingHours,
    quoteCurrency,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">
          Preview estimated swap charge for a sample position
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <WifiOff className="h-3 w-3" />
            <span>Realtime Ready</span>
          </div>
          <div className="h-2 w-2 rounded-full bg-text-muted" title="WebSocket status" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="text-sm font-semibold text-text mb-2">Input Parameters</div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Side</label>
            <Select value={side} onValueChange={(value) => setSide(value as 'long' | 'short')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="long">Long</SelectItem>
                <SelectItem value="short">Short</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Position Size</label>
            <Input
              type="number"
              step="0.01"
              value={positionSize}
              onChange={(e) => setPositionSize(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Entry Price</label>
            <Input
              type="number"
              step="0.01"
              value={entryPrice}
              onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Current Price</label>
            <Input
              type="number"
              step="0.01"
              value={currentPrice}
              onChange={(e) => setCurrentPrice(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Leverage</label>
            <Input
              type="number"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value) || 1)}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Holding Hours</label>
            <Input
              type="number"
              value={holdingHours}
              onChange={(e) => setHoldingHours(parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Quote Currency</label>
            <Input value={quoteCurrency} disabled />
          </div>
        </div>

        <div className="space-y-4">
          <div className="text-sm font-semibold text-text mb-2">Preview Result</div>
          <Card className="p-6 bg-surface-2">
            <div className="text-xs text-text-muted mb-2">Estimated Swap Charge</div>
            <div className="text-3xl font-mono font-bold text-text mb-2">
              {preview.estimatedCharge >= 0 ? '+' : ''}
              {preview.estimatedCharge.toFixed(4)} {preview.unitLabel}
            </div>
            <div className="text-xs text-text-muted mt-4">
              Applied Rate: {side === 'long' ? rule.longRate : rule.shortRate}
              {rule.unit === 'percent' ? '%' : ' ' + quoteCurrency}
            </div>
          </Card>
          <Card className="p-4 bg-surface-2">
            <div className="text-sm font-semibold text-text mb-3">Calculation Breakdown</div>
            <ul className="space-y-1 text-xs text-text-muted">
              {preview.breakdown.map((item, index) => (
                <li key={index} className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4 bg-surface-2">
            <div className="text-sm font-semibold text-text mb-2">Schedule Assumptions</div>
            <div className="text-xs text-text-muted space-y-1">
              <div>Calc Mode: {rule.calcMode}</div>
              <div>Rollover: {rule.rolloverTimeUtc} UTC</div>
              {rule.weekendRule !== 'none' && (
                <div>Weekend Rule: {rule.weekendRule}</div>
              )}
              {rule.tripleDay && (
                <div>Triple Day: {rule.tripleDay}</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal(`preview-swap-${rule.id}`)}>
          Close
        </Button>
      </div>
    </div>
  )
}

