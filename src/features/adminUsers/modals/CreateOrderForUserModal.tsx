import { useState, useEffect } from 'react'
import { ModalShell } from '@/shared/ui/modal'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import { createAdminOrder } from '@/features/adminTrading/api/orders'
import type { CreateOrderRequest } from '@/features/adminTrading/types'
import { fetchAdminSymbols } from '@/features/adminTrading/api/lookups'
import type { LookupSymbol } from '@/features/adminTrading/types'
import { toast } from '@/shared/components/common'
import { Loader2 } from 'lucide-react'

interface CreateOrderForUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userName?: string
  onSuccess?: () => void
}

export function CreateOrderForUserModal({
  open,
  onOpenChange,
  userId,
  userName,
  onSuccess,
}: CreateOrderForUserModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [symbols, setSymbols] = useState<LookupSymbol[]>([])
  const [symbolsLoading, setSymbolsLoading] = useState(false)
  const [formData, setFormData] = useState<Omit<CreateOrderRequest, 'userId'>>({
    symbolId: '',
    side: 'BUY',
    orderType: 'MARKET',
    size: 0,
    price: undefined,
    stopPrice: undefined,
    timeInForce: 'GTC',
    stopLoss: undefined,
    takeProfit: undefined,
  })

  useEffect(() => {
    if (open && symbols.length === 0) {
      setSymbolsLoading(true)
      fetchAdminSymbols()
        .then(setSymbols)
        .catch(() => toast.error('Failed to load symbols'))
        .finally(() => setSymbolsLoading(false))
    }
  }, [open, symbols.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.symbolId || formData.size <= 0) {
      toast.error('Please fill in Symbol and Size')
      return
    }
    if ((formData.orderType === 'LIMIT' || formData.orderType === 'STOP_LIMIT') && (formData.price == null || formData.price <= 0)) {
      toast.error('Please enter a limit price')
      return
    }

    setIsSubmitting(true)
    try {
      await createAdminOrder({ ...formData, userId })
      toast.success('Order created successfully')
      onOpenChange(false)
      setFormData({
        symbolId: '',
        side: 'BUY',
        orderType: 'MARKET',
        size: 0,
        price: undefined,
        stopPrice: undefined,
        timeInForce: 'GTC',
        stopLoss: undefined,
        takeProfit: undefined,
      })
      onSuccess?.()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: { message?: string }; message?: string } } }
      const msg = err?.response?.data?.error?.message ?? err?.response?.data?.message ?? 'Failed to create order'
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Create order"
      description={userName ? `Place an order on behalf of ${userName}` : 'Place an order for this user'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="symbolId">Symbol *</Label>
            <Select
              value={formData.symbolId}
              onValueChange={(value) => setFormData({ ...formData, symbolId: value })}
              disabled={symbolsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={symbolsLoading ? 'Loading…' : 'Select symbol'} />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((symbol) => (
                  <SelectItem key={symbol.id} value={symbol.id}>
                    {symbol.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="side">Side *</Label>
            <Select
              value={formData.side}
              onValueChange={(value) => setFormData({ ...formData, side: value as 'BUY' | 'SELL' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BUY">BUY</SelectItem>
                <SelectItem value="SELL">SELL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="orderType">Order type *</Label>
            <Select
              value={formData.orderType}
              onValueChange={(value) =>
                setFormData({ ...formData, orderType: value as CreateOrderRequest['orderType'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKET">MARKET</SelectItem>
                <SelectItem value="LIMIT">LIMIT</SelectItem>
                <SelectItem value="STOP">STOP</SelectItem>
                <SelectItem value="STOP_LIMIT">STOP_LIMIT</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="size">Size *</Label>
            <Input
              id="size"
              type="number"
              step="0.000001"
              min="0"
              value={formData.size || ''}
              onChange={(e) => setFormData({ ...formData, size: parseFloat(e.target.value) || 0 })}
              required
            />
          </div>

          {(formData.orderType === 'LIMIT' || formData.orderType === 'STOP_LIMIT') && (
            <div>
              <Label htmlFor="price">Price *</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={formData.price ?? ''}
                onChange={(e) =>
                  setFormData({ ...formData, price: parseFloat(e.target.value) || undefined })
                }
              />
            </div>
          )}

          {(formData.orderType === 'STOP' || formData.orderType === 'STOP_LIMIT') && (
            <div>
              <Label htmlFor="stopPrice">Stop price *</Label>
              <Input
                id="stopPrice"
                type="number"
                step="0.01"
                min="0"
                value={formData.stopPrice ?? ''}
                onChange={(e) =>
                  setFormData({ ...formData, stopPrice: parseFloat(e.target.value) || undefined })
                }
              />
            </div>
          )}

          <div>
            <Label htmlFor="timeInForce">Time in force</Label>
            <Select
              value={formData.timeInForce ?? 'GTC'}
              onValueChange={(value) =>
                setFormData({ ...formData, timeInForce: (value || 'GTC') as 'GTC' | 'IOC' | 'FOK' })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GTC">GTC</SelectItem>
                <SelectItem value="IOC">IOC</SelectItem>
                <SelectItem value="FOK">FOK</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="stopLoss">Stop loss (optional)</Label>
            <Input
              id="stopLoss"
              type="number"
              step="0.01"
              value={formData.stopLoss ?? ''}
              onChange={(e) =>
                setFormData({ ...formData, stopLoss: parseFloat(e.target.value) || undefined })
              }
            />
          </div>

          <div>
            <Label htmlFor="takeProfit">Take profit (optional)</Label>
            <Input
              id="takeProfit"
              type="number"
              step="0.01"
              value={formData.takeProfit ?? ''}
              onChange={(e) =>
                setFormData({ ...formData, takeProfit: parseFloat(e.target.value) || undefined })
              }
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create order'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}
