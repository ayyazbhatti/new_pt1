import { X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Segmented } from '@/shared/ui'
import { Checkbox } from '@/shared/ui'
import { useState, useMemo } from 'react'
import { cn } from '@/shared/utils'
import { useTerminalStore } from '../store'
import { mockSymbols } from '@/shared/mock/terminalMock'
import { toast } from 'react-hot-toast'

export function RightTradingPanel() {
  const { selectedSymbol, setSelectedSymbol } = useTerminalStore()
  const [orderType, setOrderType] = useState('market')
  const [size, setSize] = useState('0.003457')
  const [currency, setCurrency] = useState('BTC')
  const [marginPercent, setMarginPercent] = useState(1.0)
  const [useSlTp, setUseSlTp] = useState(false)
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [symbolDetailsOpen, setSymbolDetailsOpen] = useState(false)

  // Calculate costs based on size and selected symbol
  const costBreakdown = useMemo(() => {
    const sizeNum = parseFloat(size) || 0
    const price = selectedSymbol.numericPrice
    const usdValue = sizeNum * price
    const spread = 50.00
    const fees = 0
    const margin = usdValue * 0.02 // 2% margin
    const liquidation = '-'

    return {
      spread: spread.toFixed(2),
      fees: fees.toFixed(2),
      margin: margin.toFixed(2),
      liquidation,
      usdValue: usdValue.toFixed(2),
    }
  }, [size, selectedSymbol])

  const handleMaxSize = () => {
    // Set to 1% of balance
    const maxSize = (2495.56 * 0.01) / selectedSymbol.numericPrice
    setSize(maxSize.toFixed(6))
    toast.success('Size set to maximum')
  }

  const handleBuy = () => {
    toast.success(`Buy order placed: ${size} ${currency} ${selectedSymbol.code} at ${orderType} price`)
  }

  const handleSell = () => {
    toast.success(`Sell order placed: ${size} ${currency} ${selectedSymbol.code} at ${orderType} price`)
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-gradient-to-b from-[#0f172a] to-[#0b1220] flex flex-col">
      {/* Header */}
      <div className="shrink-0 h-12 border-b border-border flex items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-text">Trading Panel</h2>
        <button
          onClick={() => toast.info('Panel close feature coming soon')}
          className="p-1 hover:bg-surface-2 rounded transition-colors"
          title="Close Panel"
        >
          <X className="h-4 w-4 text-muted" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Order Ticket */}
        <div className="p-4 border-b border-border">
          <div className="text-xs font-semibold text-text mb-3">Order Ticket</div>

          {/* Symbol */}
          <div className="mb-3">
            <label className="text-xs text-muted mb-1 block">Symbol</label>
            <select
              value={selectedSymbol.code}
              onChange={(e) => {
                const symbol = mockSymbols.find((s) => s.code === e.target.value)
                if (symbol) setSelectedSymbol(symbol)
              }}
              className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
            >
              {mockSymbols.map((symbol) => (
                <option key={symbol.id} value={symbol.code}>
                  {symbol.code}
                </option>
              ))}
            </select>
          </div>

          {/* Live Quote */}
          <div className="mb-3 p-3 rounded-lg bg-surface-2 border border-border">
            <div className="text-xs text-muted mb-2">Live Quote</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted">Bid</div>
                <div className="text-sm font-medium text-text">{selectedSymbol.numericPrice.toFixed(1)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">Ask</div>
                <div className="text-sm font-medium text-text">{selectedSymbol.numericPrice2.toFixed(1)}</div>
              </div>
            </div>
          </div>

          {/* Order Type */}
          <div className="mb-3">
            <Segmented
              options={[
                { value: 'market', label: 'Market' },
                { value: 'limit', label: 'Limit' },
              ]}
              value={orderType}
              onChange={setOrderType}
              className="w-full"
            />
          </div>

          {/* Limit Price Input */}
          {orderType === 'limit' && (
            <div className="mb-3">
              <label className="text-xs text-muted mb-1 block">Limit Price</label>
              <Input
                type="number"
                step="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="Enter limit price"
                className="w-full"
              />
            </div>
          )}

          {/* Size */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted">Size</label>
              <button
                onClick={handleMaxSize}
                className="text-xs text-accent hover:text-accent/80"
                title="Set maximum size (1% of balance)"
              >
                MAX
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.000001"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="flex-1"
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
              >
                <option>BTC</option>
                <option>USD</option>
              </select>
            </div>
            <div className="text-xs text-muted mt-1">≈ {costBreakdown.usdValue} USD</div>
          </div>

          {/* Free Margin */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">Free Margin: {marginPercent.toFixed(1)}%</span>
              <span className="text-xs text-text">$24.73</span>
            </div>
            <div className="relative">
              <input
                type="range"
                min="0.1"
                max="100"
                step="0.1"
                value={marginPercent}
                onChange={(e) => setMarginPercent(Number(e.target.value))}
                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>0.1%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* Stop Loss / Take Profit */}
          <div className="mb-3">
            <div className="flex items-center mb-2">
              <Checkbox
                checked={useSlTp}
                onChange={(e) => setUseSlTp(e.target.checked)}
              />
              <span className="text-xs text-muted ml-2">Use Stop Loss / Take Profit</span>
            </div>
            {useSlTp && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-xs text-muted mb-1 block">Stop Loss</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                    placeholder="SL Price"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">Take Profit</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(e.target.value)}
                    placeholder="TP Price"
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Cost Breakdown */}
          <div className="mb-3 p-3 rounded-lg bg-surface-2 border border-border">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Spread:</span>
                <span className="text-text">{costBreakdown.spread}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Fees:</span>
                <span className="text-text">${costBreakdown.fees}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Est. Margin:</span>
                <span className="text-text">${costBreakdown.margin}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Est. Liquidation:</span>
                <span className="text-text">{costBreakdown.liquidation}</span>
              </div>
            </div>
          </div>

          {/* Leverage */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs text-muted">Leverage:</div>
                <div className="text-sm font-medium text-text">50x</div>
              </div>
              <button 
                className="p-1.5 hover:bg-surface-2 rounded transition-colors"
                title="Leverage Profile Settings"
              >
                <span className="text-xs text-muted">Profile</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="success" className="w-full py-3" onClick={handleBuy}>
              Buy / Long
            </Button>
            <Button variant="danger" className="w-full py-3" onClick={handleSell}>
              Sell / Short
            </Button>
          </div>
        </div>

        {/* Symbol Details */}
        <div className="border-b border-border">
          <button
            onClick={() => setSymbolDetailsOpen(!symbolDetailsOpen)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-2/50 transition-colors"
          >
            <span className="text-xs font-semibold text-text">Symbol Details</span>
            {symbolDetailsOpen ? (
              <ChevronUp className="h-4 w-4 text-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted" />
            )}
          </button>
          {symbolDetailsOpen && (
            <div className="px-4 pb-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Price:</span>
                <span className="text-text">${selectedSymbol.numericPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">24h Change:</span>
                <span className={selectedSymbol.change24h >= 0 ? 'text-success' : 'text-danger'}>
                  {selectedSymbol.change24h >= 0 ? '+' : ''}{selectedSymbol.change24h.toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">24h Volume:</span>
                <span className="text-text">${(selectedSymbol.volume24h / 1000000).toFixed(2)}M</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-4 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted">Current time:</span>
          <span className="text-text">UTC+5 ▼ 23:01:53 30.10.2025</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Status:</span>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-success"></div>
            <span className="text-success">ON</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Ping:</span>
          <span className="text-text">87 ms / 87 ms</span>
        </div>
      </div>
    </div>
  )
}

