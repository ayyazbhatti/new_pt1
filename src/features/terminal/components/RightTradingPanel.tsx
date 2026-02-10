import { X, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Activity } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Segmented } from '@/shared/ui'
import { Checkbox } from '@/shared/ui'
import { useState, useMemo } from 'react'
import { cn } from '@/shared/utils'
import { useTerminalStore } from '../store'
import { toast } from 'react-hot-toast'
import { SinglePriceDisplay } from './SinglePriceDisplay'

export function RightTradingPanel() {
  const { selectedSymbol, setSelectedSymbol, symbols } = useTerminalStore()
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
    if (!selectedSymbol) {
      return {
        spread: '0.00',
        fees: '0.00',
        margin: '0.00',
        liquidation: '-',
        usdValue: '0.00',
      }
    }

    const sizeNum = parseFloat(size) || 0
    const price = selectedSymbol.numericPrice || 0
    const askPrice = selectedSymbol.numericPrice2 || price
    const usdValue = sizeNum * price
    const spread = Math.abs(askPrice - price)
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
    if (!selectedSymbol || !selectedSymbol.numericPrice) {
      toast.error('Please select a symbol')
      return
    }
    // Set to 1% of balance
    const maxSize = (2495.56 * 0.01) / selectedSymbol.numericPrice
    setSize(maxSize.toFixed(6))
    toast.success('Size set to maximum')
  }

  const handleBuy = () => {
    if (!selectedSymbol) {
      toast.error('Please select a symbol')
      return
    }
    toast.success(`Buy order placed: ${size} ${currency} ${selectedSymbol.code} at ${orderType} price`)
  }

  const handleSell = () => {
    if (!selectedSymbol) {
      toast.error('Please select a symbol')
      return
    }
    toast.success(`Sell order placed: ${size} ${currency} ${selectedSymbol.code} at ${orderType} price`)
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-gradient-to-b from-[#0f172a] to-[#0b1220] flex flex-col border-l border-white/5">
      {/* Header */}
      <div className="shrink-0 h-12 border-b border-white/5 flex items-center justify-between px-4 bg-gradient-to-r from-white/[0.02] to-transparent">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-text tracking-tight">Trading Panel</h2>
          <div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></div>
        </div>
        <button
          onClick={() => toast.info('Panel close feature coming soon')}
          className="p-1.5 hover:bg-surface-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          title="Close Panel"
        >
          <X className="h-4 w-4 text-muted" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Order Ticket */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-1 rounded-full bg-accent"></div>
            <div className="text-xs font-bold text-text uppercase tracking-wider">Order Ticket</div>
          </div>

          {/* Symbol */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-muted mb-2 block uppercase tracking-wider">Symbol</label>
            <select
              value={selectedSymbol?.code || ''}
              onChange={(e) => {
                const symbol = symbols.find((s) => s.code === e.target.value)
                if (symbol) setSelectedSymbol(symbol)
              }}
              className="w-full rounded-lg bg-surface-2 border border-white/5 px-3 py-2.5 text-sm font-medium text-text focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200 hover:border-accent/30"
            >
              {symbols.length === 0 ? (
                <option value="">No symbols available</option>
              ) : (
                symbols.map((symbol) => (
                  <option key={symbol.id} value={symbol.code}>
                    {symbol.code}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Live Quote - Enhanced Professional Design */}
          {selectedSymbol && (
            <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-surface-2/80 to-surface-2/40 border border-white/5 shadow-lg shadow-black/20 relative overflow-hidden">
              {/* Live indicator */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-success animate-pulse" />
                <span className="text-[10px] font-semibold text-success uppercase tracking-wider">Live</span>
              </div>
              
              <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Live Quote</div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted/70 uppercase tracking-wider">Bid</div>
                  {selectedSymbol.numericPrice > 0 ? (
                    <SinglePriceDisplay
                      price={selectedSymbol.numericPrice}
                      formatted={selectedSymbol.numericPrice.toFixed(selectedSymbol.numericPrice % 1 === 0 ? 0 : 2)}
                    />
                  ) : (
                    <div className="text-lg font-bold text-text-muted">—</div>
                  )}
                </div>
                <div className="space-y-1.5 text-right">
                  <div className="text-[10px] text-muted/70 uppercase tracking-wider">Ask</div>
                  {selectedSymbol.numericPrice2 > 0 ? (
                    <div className="flex justify-end">
                      <SinglePriceDisplay
                        price={selectedSymbol.numericPrice2}
                        formatted={selectedSymbol.numericPrice2.toFixed(selectedSymbol.numericPrice2 % 1 === 0 ? 0 : 2)}
                      />
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-text-muted">—</div>
                  )}
                </div>
              </div>
              
              {/* Spread indicator */}
              {selectedSymbol.numericPrice > 0 && selectedSymbol.numericPrice2 > 0 && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted/70">Spread</span>
                    <span className="text-xs font-semibold text-text">
                      {Math.abs(selectedSymbol.numericPrice2 - selectedSymbol.numericPrice).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Order Type */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-muted mb-2 block uppercase tracking-wider">Order Type</label>
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
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider">Size</label>
              <button
                onClick={handleMaxSize}
                className="text-xs font-bold text-accent hover:text-accent/80 transition-colors px-2 py-0.5 rounded hover:bg-accent/10"
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
                className="rounded-lg bg-surface-2 border border-white/5 px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
              >
                <option>BTC</option>
                <option>USD</option>
              </select>
            </div>
            <div className="text-xs text-muted mt-1">≈ {costBreakdown.usdValue} USD</div>
          </div>

          {/* Free Margin */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Free Margin: {marginPercent.toFixed(1)}%</span>
              <span className="text-xs font-bold text-text">$24.73</span>
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

          {/* Cost Breakdown - Enhanced */}
          <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-surface-2/60 to-surface-2/30 border border-white/5 shadow-md">
            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Cost Breakdown</div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted/80">Spread</span>
                <span className="font-semibold text-text">{costBreakdown.spread}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted/80">Fees</span>
                <span className="font-semibold text-text">${costBreakdown.fees}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-white/5">
                <span className="text-muted/80">Est. Margin</span>
                <span className="font-semibold text-accent">${costBreakdown.margin}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted/80">Est. Liquidation</span>
                <span className="font-semibold text-text">{costBreakdown.liquidation}</span>
              </div>
            </div>
          </div>

          {/* Leverage */}
          <div className="mb-4 p-3 rounded-lg bg-surface-2/30 border border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Leverage</div>
                <div className="text-base font-bold text-accent">50x</div>
              </div>
              <button 
                className="px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
                title="Leverage Profile Settings"
              >
                Profile
              </button>
            </div>
          </div>

          {/* Action Buttons - Enhanced */}
          <div className="grid grid-cols-2 gap-3">
            <Button 
              variant="success" 
              className="w-full py-3.5 font-bold text-sm shadow-lg shadow-success/20 hover:shadow-success/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" 
              onClick={handleBuy}
            >
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="h-4 w-4" />
                <span>Buy / Long</span>
              </div>
            </Button>
            <Button 
              variant="danger" 
              className="w-full py-3.5 font-bold text-sm shadow-lg shadow-danger/20 hover:shadow-danger/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" 
              onClick={handleSell}
            >
              <div className="flex items-center justify-center gap-2">
                <TrendingDown className="h-4 w-4" />
                <span>Sell / Short</span>
              </div>
            </Button>
          </div>
        </div>

        {/* Symbol Details - Enhanced */}
        <div className="border-b border-white/5">
          <button
            onClick={() => setSymbolDetailsOpen(!symbolDetailsOpen)}
            className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-surface-2/30 transition-all duration-200 group"
          >
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-accent"></div>
              <span className="text-xs font-bold text-text uppercase tracking-wider">Symbol Details</span>
            </div>
            {symbolDetailsOpen ? (
              <ChevronUp className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted group-hover:text-text transition-colors" />
            )}
          </button>
          {symbolDetailsOpen && selectedSymbol && (
            <div className="px-4 pb-4 space-y-3 text-xs bg-surface-2/20">
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-muted/80">Price</span>
                <span className="font-semibold text-text">
                  {selectedSymbol.numericPrice > 0 
                    ? `$${selectedSymbol.numericPrice.toLocaleString()}`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-muted/80">24h Change</span>
                <div className={cn(
                  "flex items-center gap-1.5 font-semibold",
                  selectedSymbol.change24h >= 0 ? 'text-success' : 'text-danger'
                )}>
                  {selectedSymbol.change24h >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  <span>{selectedSymbol.change24h >= 0 ? '+' : ''}{selectedSymbol.change24h.toFixed(4)}%</span>
                </div>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-muted/80">24h Volume</span>
                <span className="font-semibold text-text">${(selectedSymbol.volume24h / 1000000).toFixed(2)}M</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer - Enhanced */}
      <div className="shrink-0 border-t border-white/5 p-4 space-y-2.5 text-xs bg-gradient-to-t from-white/[0.02] to-transparent">
        <div className="flex items-center justify-between py-1">
          <span className="text-muted/70">Current time</span>
          <span className="font-mono font-semibold text-text">UTC+5 ▼ 23:01:53 30.10.2025</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted/70">Status</span>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse shadow-sm shadow-success/50"></div>
            <span className="font-semibold text-success">ON</span>
          </div>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted/70">Ping</span>
          <span className="font-mono font-semibold text-text">87 ms / 87 ms</span>
        </div>
      </div>
    </div>
  )
}

