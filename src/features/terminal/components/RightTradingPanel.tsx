import { X, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Activity, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui'
import { Input } from '@/shared/ui'
import { Segmented } from '@/shared/ui'
import { Checkbox } from '@/shared/ui'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { cn } from '@/shared/utils'
import { useTerminalStore } from '../store'
import { toast } from 'react-hot-toast'
import { SinglePriceDisplay } from './SinglePriceDisplay'
import { placeOrder, PlaceOrderRequest } from '../api/orders.api'
import { useAuthStore } from '@/shared/store/auth.store'
import { wsClient } from '@/shared/ws/wsClient'
import { WsInboundEvent } from '@/shared/ws/wsEvents'

export function RightTradingPanel() {
  const { selectedSymbol, setSelectedSymbol, symbols } = useTerminalStore()
  const [orderType, setOrderType] = useState('market')
  const [size, setSize] = useState('0.003457')
  const [currency, setCurrency] = useState<string>('')
  const [marginPercent, setMarginPercent] = useState(1.0)
  const [useSlTp, setUseSlTp] = useState(false)
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [symbolDetailsOpen, setSymbolDetailsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingOrders, setPendingOrders] = useState<Set<string>>(new Set())

  // Update currency to base currency when symbol changes
  useEffect(() => {
    if (selectedSymbol?.baseCurrency) {
      // Only update if currency is not set or if it's not a valid currency for this symbol
      if (!currency || (currency !== selectedSymbol.baseCurrency && currency !== selectedSymbol.quoteCurrency)) {
        setCurrency(selectedSymbol.baseCurrency)
      }
    }
  }, [selectedSymbol?.baseCurrency, selectedSymbol?.quoteCurrency])

  // Calculate costs based on size and selected symbol
  // Size is always stored in the current currency mode (base or quote)
  // We need to convert to base currency for calculations
  const costBreakdown = useMemo(() => {
    if (!selectedSymbol) {
      return {
        spread: '0.00',
        fees: '0.00',
        margin: '0.00',
        liquidation: '-',
        usdValue: '0.00',
        baseSize: '0.00',
        quoteValue: '0.00',
      }
    }

    const sizeNum = parseFloat(size) || 0
    const price = selectedSymbol.numericPrice || 0
    const askPrice = selectedSymbol.numericPrice2 || price
    
    // Convert size to base currency for calculations
    let baseSize = sizeNum
    let quoteValue = sizeNum * price
    
    if (currency === selectedSymbol.quoteCurrency && price > 0) {
      // Size is in quote currency, convert to base
      baseSize = sizeNum / price
      quoteValue = sizeNum
    } else {
      // Size is in base currency
      quoteValue = sizeNum * price
    }
    
    const spread = Math.abs(askPrice - price)
    const fees = 0
    const margin = quoteValue * 0.02 // 2% margin
    const liquidation = '-'

    return {
      spread: spread.toFixed(2),
      fees: fees.toFixed(2),
      margin: margin.toFixed(2),
      liquidation,
      usdValue: quoteValue.toFixed(2),
      baseSize: baseSize.toFixed(8),
      quoteValue: quoteValue.toFixed(2),
    }
  }, [size, selectedSymbol, currency])

  // Format live price for limit price placeholder
  const livePricePlaceholder = useMemo(() => {
    if (!selectedSymbol || selectedSymbol.numericPrice <= 0) {
      return 'Enter limit price'
    }
    // Use bid price (numericPrice) as the reference
    const price = selectedSymbol.numericPrice
    // Determine precision based on price value
    if (price >= 1000) {
      return `Current: ${price.toFixed(2)}`
    } else if (price >= 1) {
      return `Current: ${price.toFixed(4)}`
    } else {
      return `Current: ${price.toFixed(8)}`
    }
  }, [selectedSymbol])

  // Format live price for market size placeholder
  const marketSizePlaceholder = useMemo(() => {
    if (!selectedSymbol || selectedSymbol.numericPrice <= 0) {
      return 'Enter size'
    }
    // Show current market price as reference
    const price = selectedSymbol.numericPrice
    const formattedPrice = price >= 1000 
      ? price.toFixed(2) 
      : price >= 1 
        ? price.toFixed(4) 
        : price.toFixed(8)
    
    if (currency === selectedSymbol.quoteCurrency) {
      // In quote currency mode, show example value
      return `e.g., 100 (Current: ${formattedPrice})`
    } else {
      // In base currency mode, show example quantity
      return `e.g., 0.1 (Current: ${formattedPrice})`
    }
  }, [selectedSymbol, currency])

  const handleMaxSize = () => {
    if (!selectedSymbol || !selectedSymbol.numericPrice) {
      toast.error('Please select a symbol')
      return
    }
    // Set to 1% of balance (in quote currency)
    const maxQuoteValue = 2495.56 * 0.01
    if (currency === selectedSymbol.quoteCurrency) {
      // If in quote currency mode, set directly
      setSize(maxQuoteValue.toFixed(2))
    } else {
      // If in base currency mode, convert to base
      const maxBaseSize = maxQuoteValue / selectedSymbol.numericPrice
      setSize(maxBaseSize.toFixed(8))
    }
    toast.success('Size set to maximum')
  }

  // Handle currency change with conversion
  const handleCurrencyChange = (newCurrency: string) => {
    if (!selectedSymbol || !selectedSymbol.numericPrice || currency === newCurrency) {
      setCurrency(newCurrency)
      return
    }

    const sizeNum = parseFloat(size) || 0
    if (sizeNum <= 0) {
      setCurrency(newCurrency)
      return
    }

    const price = selectedSymbol.numericPrice || 0
    if (price <= 0) {
      setCurrency(newCurrency)
      return
    }

    let newSize = sizeNum

    if (currency === selectedSymbol.baseCurrency && newCurrency === selectedSymbol.quoteCurrency) {
      // Converting from base to quote: baseSize * price = quoteValue
      newSize = sizeNum * price
    } else if (currency === selectedSymbol.quoteCurrency && newCurrency === selectedSymbol.baseCurrency) {
      // Converting from quote to base: quoteValue / price = baseSize
      newSize = sizeNum / price
    }

    // Format based on currency type
    if (newCurrency === selectedSymbol.quoteCurrency) {
      setSize(newSize.toFixed(2))
    } else {
      setSize(newSize.toFixed(8))
    }

    setCurrency(newCurrency)
  }

  // Use shared WebSocket client for order updates
  const [wsConnected, setWsConnected] = useState(false)
  
  useEffect(() => {
    // Ensure WebSocket is connected
    if (wsClient.getState() === 'disconnected') {
      wsClient.connect()
    }
    
    // Update connection status
    const updateStatus = () => {
      const state = wsClient.getState()
      setWsConnected(state === 'authenticated')
    }
    updateStatus()
    
    // Subscribe to state changes
    const unsubscribeState = wsClient.onStateChange((state) => {
      setWsConnected(state === 'authenticated')
    })

    // Subscribe to order update events
    const unsubscribe = wsClient.subscribe((event: WsInboundEvent) => {
      // Handle order update events (when backend sends them via WebSocket)
      if (event.type === 'admin.order.updated' || event.type === 'admin.order.filled' || event.type === 'admin.order.canceled' || event.type === 'admin.order.rejected') {
        const order = (event as any).payload.order || (event as any).payload
        const orderId = order?.orderId || order?.id || (event as any).payload.orderId
        
        if (orderId && typeof orderId === 'string' && pendingOrders.has(orderId)) {
          setPendingOrders(prev => {
            const next = new Set(prev)
            next.delete(orderId)
            return next
          })
          
          const status = order?.status || (event as any).payload.status
          if (status === 'Filled' || status === 'FILLED' || status === 'filled') {
            toast.success(`Order ${orderId.slice(0, 8)}... filled successfully`, { duration: 4000 })
          } else if (status === 'Rejected' || status === 'REJECTED' || status === 'rejected') {
            toast.error(
              `Order ${orderId.slice(0, 8)}... rejected: ${order?.reason || (event as any).payload.reason || 'Unknown reason'}`,
              { duration: 5000 }
            )
          } else if (status === 'Cancelled' || status === 'CANCELLED' || status === 'cancelled') {
            toast.info(`Order ${orderId.slice(0, 8)}... cancelled`, { duration: 3000 })
          }
        }
      }
    })

    return () => {
      unsubscribe()
      unsubscribeState()
    }
  }, [pendingOrders])

  const handlePlaceOrder = async (side: 'BUY' | 'SELL') => {
    if (!selectedSymbol) {
      toast.error('Please select a symbol')
      return
    }

    const sizeNum = parseFloat(size)
    if (!sizeNum || sizeNum <= 0) {
      toast.error('Please enter a valid size')
      return
    }

    if (orderType === 'limit' && !limitPrice) {
      toast.error('Please enter a limit price for limit orders')
      return
    }

    setIsSubmitting(true)

    try {
      // Convert size to base currency (API always expects base currency)
      const price = selectedSymbol.numericPrice || 0
      let baseSize = sizeNum
      
      if (currency === selectedSymbol.quoteCurrency && price > 0) {
        // Size is in quote currency, convert to base
        baseSize = sizeNum / price
      }

      const payload: PlaceOrderRequest = {
        symbol: selectedSymbol.code,
        side,
        order_type: orderType.toUpperCase() as 'MARKET' | 'LIMIT',
        size: baseSize.toString(),
        limit_price: orderType === 'limit' && limitPrice ? limitPrice : undefined,
        sl: useSlTp && stopLoss ? stopLoss : undefined,
        tp: useSlTp && takeProfit ? takeProfit : undefined,
        tif: 'GTC',
        idempotency_key: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      }

      const response = await placeOrder(payload)
      
      // Handle both camelCase (API) and snake_case (legacy) for compatibility
      const orderId = response.orderId || (response as any).order_id
      
      if (!orderId) {
        throw new Error('Order ID not returned from server')
      }
      
      setPendingOrders(prev => new Set(prev).add(orderId))
      
      // Show "submitted" message - actual execution happens asynchronously
      const displaySize = currency === selectedSymbol.quoteCurrency 
        ? `${size} ${selectedSymbol.quoteCurrency} (${baseSize.toFixed(8)} ${selectedSymbol.baseCurrency})`
        : `${size} ${selectedSymbol.baseCurrency}`
      toast.success(
        `${side} order submitted: ${displaySize} @ ${selectedSymbol.code} (Order ID: ${orderId.slice(0, 8)}...)`,
        { duration: 3000 }
      )

      // Reset form for market orders (keep limit orders for potential modifications)
      if (orderType === 'market') {
        setSize('0.003457')
        setStopLoss('')
        setTakeProfit('')
        setUseSlTp(false)
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to place order'
      toast.error(`Order failed: ${errorMessage}`)
      console.error('Order placement error:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBuy = () => {
    handlePlaceOrder('BUY')
  }

  const handleSell = () => {
    handlePlaceOrder('SELL')
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
                placeholder={livePricePlaceholder}
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
                placeholder={orderType === 'market' ? marketSizePlaceholder : 'Enter size'}
                className="flex-1"
              />
              <select
                value={currency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
                className="rounded-lg bg-surface-2 border border-white/5 px-3 py-2 text-sm text-text focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:ring-offset-0 transition-all duration-200"
                disabled={!selectedSymbol}
              >
                {selectedSymbol ? (
                  <>
                    <option value={selectedSymbol.baseCurrency}>{selectedSymbol.baseCurrency}</option>
                    <option value={selectedSymbol.quoteCurrency}>{selectedSymbol.quoteCurrency}</option>
                  </>
                ) : (
                  <option value="">Select Symbol</option>
                )}
              </select>
            </div>
            <div className="text-xs text-muted mt-1">
              {selectedSymbol && currency ? (
                currency === selectedSymbol.baseCurrency ? (
                  <>≈ {costBreakdown.quoteValue} {selectedSymbol.quoteCurrency}</>
                ) : (
                  <>≈ {costBreakdown.baseSize} {selectedSymbol.baseCurrency}</>
                )
              ) : (
                <>≈ 0.00 USD</>
              )}
            </div>
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
              disabled={isSubmitting || !selectedSymbol || !wsConnected}
            >
              <div className="flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
                <span>Buy / Long</span>
              </div>
            </Button>
            <Button 
              variant="danger" 
              className="w-full py-3.5 font-bold text-sm shadow-lg shadow-danger/20 hover:shadow-danger/30 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" 
              onClick={handleSell}
              disabled={isSubmitting || !selectedSymbol || !wsConnected}
            >
              <div className="flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                <span>Sell / Short</span>
              </div>
            </Button>
          </div>
          {!wsConnected && (
            <div className="mt-2 text-xs text-warning text-center">
              ⚠️ WebSocket disconnected - order updates may be delayed
            </div>
          )}
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

