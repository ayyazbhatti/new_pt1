import { useState, useEffect } from 'react'
import { ModalShell } from '@/shared/ui/modal'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import { useAdminTradingStore } from '../store/adminTrading.store'
import { createAdminOrder, CreateOrderRequest } from '../api/orders'
import { searchAdminUsers } from '../api/lookups'
import { toast } from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

export function OrderCreateModal() {
  const { openModal, setOpenModal, symbols, users, setUsers } = useAdminTradingStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<CreateOrderRequest>({
    userId: '',
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

  const open = openModal === 'create-order'

  // Load users on mount
  useEffect(() => {
    if (open && users.length === 0) {
      searchAdminUsers('').then(setUsers).catch(console.error)
    }
  }, [open, users.length, setUsers])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.userId || !formData.symbolId || formData.size <= 0) {
      toast.error('Please fill in all required fields')
      return
    }

    setIsSubmitting(true)
    try {
      await createAdminOrder(formData)
      toast.success('Order created successfully')
      setOpenModal(null)
      // Reset form
      setFormData({
        userId: '',
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
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to create order')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(open) => setOpenModal(open ? 'create-order' : null)}
      title="Create Order"
      description="Create an order for a user"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="userId">User *</Label>
            <Select
              value={formData.userId}
              onValueChange={(value) => setFormData({ ...formData, userId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.firstName} {user.lastName} ({user.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="symbolId">Symbol *</Label>
            <Select
              value={formData.symbolId}
              onValueChange={(value) => setFormData({ ...formData, symbolId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select symbol" />
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
            <Label htmlFor="orderType">Order Type *</Label>
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
                value={formData.price || ''}
                onChange={(e) =>
                  setFormData({ ...formData, price: parseFloat(e.target.value) || undefined })
                }
                required
              />
            </div>
          )}

          {(formData.orderType === 'STOP' || formData.orderType === 'STOP_LIMIT') && (
            <div>
              <Label htmlFor="stopPrice">Stop Price *</Label>
              <Input
                id="stopPrice"
                type="number"
                step="0.01"
                min="0"
                value={formData.stopPrice || ''}
                onChange={(e) =>
                  setFormData({ ...formData, stopPrice: parseFloat(e.target.value) || undefined })
                }
                required
              />
            </div>
          )}

          <div>
            <Label htmlFor="timeInForce">Time In Force</Label>
            <Select
              value={formData.timeInForce}
              onValueChange={(value) =>
                setFormData({ ...formData, timeInForce: value as 'GTC' | 'IOC' | 'FOK' })
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
            <Label htmlFor="stopLoss">Stop Loss (Optional)</Label>
            <Input
              id="stopLoss"
              type="number"
              step="0.01"
              value={formData.stopLoss || ''}
              onChange={(e) =>
                setFormData({ ...formData, stopLoss: parseFloat(e.target.value) || undefined })
              }
            />
          </div>

          <div>
            <Label htmlFor="takeProfit">Take Profit (Optional)</Label>
            <Input
              id="takeProfit"
              type="number"
              step="0.01"
              value={formData.takeProfit || ''}
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
            onClick={() => setOpenModal(null)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Order'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

