import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { MarkupRule } from '../types/markup'
import { useModalStore } from '@/app/store'
import { computeFinalPrice } from '../utils/computeFinalPrice'
import { mockProviderPrices } from '../mocks/providerPrices.mock'
import { Wifi, WifiOff } from 'lucide-react'

interface PreviewMarkupModalProps {
  rule: MarkupRule
}

export function PreviewMarkupModal({ rule }: PreviewMarkupModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)

  const defaultPrices = mockProviderPrices[rule.symbol] || { bid: 1000, ask: 1001 }
  const [providerBid, setProviderBid] = useState(defaultPrices.bid)
  const [providerAsk, setProviderAsk] = useState(defaultPrices.ask)

  const preview = computeFinalPrice(providerBid, providerAsk, rule)

  const getMarkupExplanation = () => {
    if (rule.markupType === 'fixed') {
      return `Fixed markup adds ${rule.value} to the price`
    } else if (rule.markupType === 'percent') {
      return `Percent markup adds ${rule.value}% to the price`
    } else {
      if (rule.applyTo === 'both') {
        return `Spread markup expands spread by ${rule.value} (ask +${rule.value / 2}, bid -${rule.value / 2})`
      } else if (rule.applyTo === 'ask') {
        return `Spread markup adds ${rule.value} to ask price`
      } else {
        return `Spread markup subtracts ${rule.value} from bid price`
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">
          Preview how markup is applied to provider prices
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <WifiOff className="h-3 w-3" />
            <span>Realtime Ready</span>
          </div>
          <div className="h-2 w-2 rounded-full bg-text-muted" title="WebSocket status" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Provider Bid</label>
          <Input
            type="number"
            step="0.01"
            value={providerBid}
            onChange={(e) => setProviderBid(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text mb-2 block">Provider Ask</label>
          <Input
            type="number"
            step="0.01"
            value={providerAsk}
            onChange={(e) => setProviderAsk(parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-xs text-text-muted mb-2">Provider Bid</div>
          <div className="text-2xl font-mono font-bold text-text">{providerBid.toFixed(rule.rounding)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-muted mb-2">Provider Ask</div>
          <div className="text-2xl font-mono font-bold text-text">{providerAsk.toFixed(rule.rounding)}</div>
        </Card>
      </div>

      <div className="flex items-center justify-center">
        <div className="text-text-muted">↓</div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4 bg-surface-2">
          <div className="text-xs text-text-muted mb-2">Final Bid</div>
          <div className="text-2xl font-mono font-bold text-text">{preview.finalBid.toFixed(rule.rounding)}</div>
          <div className="text-xs text-text-muted mt-1">
            Markup: {preview.appliedMarkupBid >= 0 ? '+' : ''}
            {preview.appliedMarkupBid.toFixed(rule.rounding)}
          </div>
        </Card>
        <Card className="p-4 bg-surface-2">
          <div className="text-xs text-text-muted mb-2">Final Ask</div>
          <div className="text-2xl font-mono font-bold text-text">{preview.finalAsk.toFixed(rule.rounding)}</div>
          <div className="text-xs text-text-muted mt-1">
            Markup: {preview.appliedMarkupAsk >= 0 ? '+' : ''}
            {preview.appliedMarkupAsk.toFixed(rule.rounding)}
          </div>
        </Card>
      </div>

      <Card className="p-4 bg-surface-2">
        <div className="space-y-2">
          <div className="text-sm font-semibold text-text mb-2">Rule Details</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-text-muted">Type:</span>{' '}
              <Badge variant="neutral" className="ml-1">{rule.markupType}</Badge>
            </div>
            <div>
              <span className="text-text-muted">Value:</span>{' '}
              <span className="font-mono">{rule.value}{rule.markupType === 'percent' ? '%' : ''}</span>
            </div>
            <div>
              <span className="text-text-muted">Apply To:</span>{' '}
              <span className="capitalize">{rule.applyTo}</span>
            </div>
            <div>
              <span className="text-text-muted">Rounding:</span>{' '}
              <span className="font-mono">{rule.rounding} decimals</span>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-text-muted">{getMarkupExplanation()}</div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={() => closeModal(`preview-${rule.id}`)}>
          Close
        </Button>
      </div>
    </div>
  )
}

