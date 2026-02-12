import { useEffect, useRef, useState, useCallback } from 'react'
import { useWebSocket, PriceTick } from '@/shared/hooks/useWebSocket'

// Clean URL - Use gateway-ws on port 3003 (which forwards ticks from NATS)
// Fallback to data-provider on 9003 if VITE_DATA_PROVIDER_WS_URL is explicitly set
const getCleanWsUrl = () => {
  // Check if explicitly set, otherwise use gateway-ws
  if (import.meta.env.VITE_DATA_PROVIDER_WS_URL) {
    let url = import.meta.env.VITE_DATA_PROVIDER_WS_URL
    // Only remove trailing slash, keep /ws path for gateway-ws
    url = url.replace(/\/$/, '')
  return url
  }
  // Default to gateway-ws which forwards ticks from NATS (requires /ws path)
  return 'ws://localhost:3003/ws'
}

const DATA_PROVIDER_WS_URL = getCleanWsUrl()

interface PriceData {
  bid: string
  ask: string
  ts: number
}

// Global price store to avoid re-renders
const priceStore = new Map<string, PriceData>()

// Subscribers map: symbol -> Set of callbacks
const subscribers = new Map<string, Set<(price: PriceData) => void>>()

// Notify all subscribers for a symbol
function notifySubscribers(symbol: string, price: PriceData) {
  const symbolUpper = symbol.toUpperCase()
  console.log(`📥 Received price update for ${symbolUpper}:`, price)
  console.log(`📥 Price store before update - keys:`, Array.from(priceStore.keys()))
  priceStore.set(symbolUpper, price)
  console.log(`📥 Price store after update - keys:`, Array.from(priceStore.keys()))
  
  const callbacks = subscribers.get(symbolUpper)
  console.log(`📥 Subscribers for ${symbolUpper}:`, callbacks ? callbacks.size : 0, '| All subscriber keys:', Array.from(subscribers.keys()))
  
  if (callbacks && callbacks.size > 0) {
    console.log(`📊 Notifying ${callbacks.size} subscribers for ${symbolUpper}:`, price)
    // Create a copy of callbacks to avoid issues if callbacks are modified during iteration
    const callbacksArray = Array.from(callbacks)
    callbacksArray.forEach((callback, index) => {
      try {
        console.log(`📊 Calling callback ${index + 1}/${callbacksArray.length} for ${symbolUpper}`)
        callback(price)
        console.log(`✅ Callback ${index + 1} completed for ${symbolUpper}`)
      } catch (error) {
        console.error(`❌ Error in subscriber callback ${index + 1} for ${symbolUpper}:`, error)
      }
    })
  } else {
    console.warn(`⚠️ No subscribers found for symbol: ${symbolUpper}. Available subscribers:`, Array.from(subscribers.keys()))
    console.warn(`⚠️ Price was received but no one is listening. Price stored for later.`)
  }
}

export function usePriceStream(symbols: string[]) {
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map())
  const callbackRef = useRef<(symbol: string, price: PriceData) => void>()
  const subscribedSymbolsRef = useRef<Set<string>>(new Set())
  const symbolsRef = useRef<string[]>([])
  const subscribeFnRef = useRef<((symbols: string[]) => boolean) | null>(null)
  const unsubscribeFnRef = useRef<((symbols: string[]) => void) | null>(null)

  // Update symbols ref when they change
  useEffect(() => {
    symbolsRef.current = symbols.map(s => s.toUpperCase().trim()).filter(s => s.length > 0)
  }, [symbols.join(',')])

  // Create callback that updates only the specific symbol - use useCallback to ensure stability
  const updatePrice = useCallback((symbol: string, price: PriceData) => {
    console.log(`🔄 usePriceStream callback: Updating price for ${symbol}:`, price)
    setPrices((prev) => {
      const next = new Map(prev)
      next.set(symbol, price)
      console.log(`🔄 usePriceStream: Price map updated. New size: ${next.size}, Keys:`, Array.from(next.keys()))
      return next
    })
  }, [])

  // Set the callback ref
  useEffect(() => {
    callbackRef.current = updatePrice
  }, [updatePrice])

  // Function to perform subscription (defined BEFORE useWebSocket to avoid closure issues)
  // Use refs to avoid closure issues
  const performSubscriptionRef = useRef<() => void>()
  
  performSubscriptionRef.current = () => {
    const symbolsUpper = symbolsRef.current
    const subscribeFn = subscribeFnRef.current
    const unsubscribeFn = unsubscribeFnRef.current
    
    if (symbolsUpper.length === 0) {
      console.log('⏳ No symbols to subscribe to')
      return
    }

    if (!subscribeFn || !unsubscribeFn) {
      console.warn('⚠️ Subscribe/unsubscribe functions not available yet')
      return
    }

    console.log('🔄 Processing subscription for:', symbolsUpper)
    
    // Check which symbols need to be subscribed (not already subscribed)
    const symbolsToSubscribe = symbolsUpper.filter(s => !subscribedSymbolsRef.current.has(s))
    const symbolsToUnsubscribe = Array.from(subscribedSymbolsRef.current).filter(s => !symbolsUpper.includes(s))
    
    console.log('🔍 Subscription analysis:', {
      allSymbols: symbolsUpper,
      toSubscribe: symbolsToSubscribe,
      toUnsubscribe: symbolsToUnsubscribe,
      currentlySubscribed: Array.from(subscribedSymbolsRef.current),
    })
    
    // Unsubscribe from symbols that are no longer needed
    if (symbolsToUnsubscribe.length > 0) {
      console.log('📥 Unsubscribing from symbols:', symbolsToUnsubscribe)
      unsubscribeFn(symbolsToUnsubscribe)
      symbolsToUnsubscribe.forEach(s => subscribedSymbolsRef.current.delete(s))
    }
    
    // Subscribe to new symbols - batch into chunks of 50 (server limit)
    if (symbolsToSubscribe.length > 0) {
      console.log('📡 EXECUTING subscription for symbols:', symbolsToSubscribe)
      
      const MAX_SYMBOLS_PER_BATCH = 50
      const batches: string[][] = []
      
      // Split symbols into batches of 50
      for (let i = 0; i < symbolsToSubscribe.length; i += MAX_SYMBOLS_PER_BATCH) {
        batches.push(symbolsToSubscribe.slice(i, i + MAX_SYMBOLS_PER_BATCH))
      }
      
      console.log(`📦 Split ${symbolsToSubscribe.length} symbols into ${batches.length} batches of max ${MAX_SYMBOLS_PER_BATCH} symbols each`)
      
      // Subscribe to each batch
      let allSucceeded = true
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        console.log(`📡 Subscribing to batch ${i + 1}/${batches.length} (${batch.length} symbols):`, batch)
        
        const success = subscribeFn(batch)
        console.log(`📡 subscribe() returned for batch ${i + 1}:`, success)
        
        if (success) {
          // If subscribe succeeded, track the symbols
          batch.forEach(s => subscribedSymbolsRef.current.add(s))
          console.log(`✅ Subscription successful for batch ${i + 1}:`, batch)
        } else {
          console.warn(`⚠️ Subscription failed for batch ${i + 1} - WebSocket may not be ready yet`)
          allSucceeded = false
        }
      }
      
      if (allSucceeded) {
        console.log('✅ All batches subscribed successfully')
        console.log('✅ Updated subscribed symbols:', Array.from(subscribedSymbolsRef.current))
        console.log('✅ Waiting for price ticks from server...')
      } else {
        console.warn('⚠️ Some batches failed - will retry when WebSocket is ready')
      }
    } else {
      console.log('ℹ️ All symbols already subscribed, no action needed')
    }
  }

  // Subscribe to symbols - IMPORTANT: Include updatePrice in dependencies
  useEffect(() => {
    const symbolsUpper = symbols.map(s => s.toUpperCase().trim()).filter(s => s.length > 0)
    console.log('🔔 Subscribing to symbols:', symbolsUpper)
    console.log('🔔 Current price store keys before subscription:', Array.from(priceStore.keys()))
    console.log('🔔 updatePrice function exists:', typeof updatePrice === 'function')
    console.log('🔔 updatePrice function:', updatePrice)
    
    // Create a wrapper callback that matches the subscriber signature (price: PriceData) => void
    const wrappedCallbacks = new Map<string, (price: PriceData) => void>()
    
    symbolsUpper.forEach((symbol) => {
      if (!subscribers.has(symbol)) {
        subscribers.set(symbol, new Set())
      }
      const callbacks = subscribers.get(symbol)!
      
      // Create a wrapped callback that includes the symbol
      // Use updatePrice directly (it's stable from useCallback) instead of relying on ref
      const wrappedCallback = (price: PriceData) => {
        console.log(`📞 Wrapped callback called for ${symbol} with price:`, price)
        console.log(`📞 updatePrice function exists:`, typeof updatePrice === 'function')
        // Always use updatePrice directly - it's stable from useCallback
        if (updatePrice) {
          console.log(`✅ Calling updatePrice for ${symbol}`)
          try {
            updatePrice(symbol, price)
            console.log(`✅ Successfully updated price for ${symbol}`)
          } catch (error) {
            console.error(`❌ Error updating price for ${symbol}:`, error)
          }
        } else {
          console.error(`❌ updatePrice is not available for ${symbol}`)
        }
      }
      wrappedCallbacks.set(symbol, wrappedCallback)
      
      callbacks.add(wrappedCallback)
      console.log(`✅ Added subscriber for ${symbol}, total: ${callbacks.size}`)

      // Set initial price if available
      const initialPrice = priceStore.get(symbol)
      if (initialPrice) {
        console.log(`💰 Initial price found for ${symbol}:`, initialPrice)
        wrappedCallback(initialPrice)
      } else {
        console.log(`⏳ No initial price for ${symbol}, waiting for price update...`)
      }
    })
    
    console.log('🔔 All subscribers after setup:', Array.from(subscribers.keys()))

    return () => {
      symbolsUpper.forEach((symbol) => {
        const callbacks = subscribers.get(symbol)
        const wrappedCallback = wrappedCallbacks.get(symbol)
        if (callbacks && wrappedCallback) {
          callbacks.delete(wrappedCallback)
          if (callbacks.size === 0) {
            subscribers.delete(symbol)
          }
        }
      })
    }
  }, [symbols.join(','), updatePrice]) // Include updatePrice in dependencies

  // WebSocket connection
  const wsEnabled = symbols.length > 0
  console.log('🔌 usePriceStream: WebSocket enabled:', wsEnabled, '| symbols.length:', symbols.length, '| URL:', DATA_PROVIDER_WS_URL)
  console.log('🔌 usePriceStream: Symbols to subscribe:', symbols)
  console.log('🔌 usePriceStream: DATA_PROVIDER_WS_URL:', DATA_PROVIDER_WS_URL)
  
  const { isConnected, subscribe, unsubscribe } = useWebSocket({
    url: DATA_PROVIDER_WS_URL,
    onMessage: (tick: PriceTick) => {
      console.log('📨 usePriceStream received tick:', tick)
      console.log('📨 Tick symbol:', tick.symbol, '| Bid:', tick.bid, '| Ask:', tick.ask)
      // Ensure symbol is uppercase to match subscription format
      const symbolUpper = tick.symbol.toUpperCase().trim()
      console.log('📨 Processing tick for symbol:', symbolUpper)
      console.log('📨 Current subscribers:', Array.from(subscribers.keys()))
      console.log('📨 Current price store:', Array.from(priceStore.keys()))
      notifySubscribers(symbolUpper, {
        bid: tick.bid,
        ask: tick.ask,
        ts: tick.ts,
      })
    },
    onOpen: () => {
      console.log('🎉 usePriceStream: WebSocket opened')
      // When WebSocket opens, subscribe to current symbols
      // Use a longer delay to ensure WebSocket ref is fully set and stable
      setTimeout(() => {
        console.log('🔄 WebSocket opened, subscribing to symbols:', symbolsRef.current)
        if (performSubscriptionRef.current) {
          performSubscriptionRef.current()
        } else {
          console.warn('⚠️ performSubscription not available yet')
        }
      }, 300)
    },
    onError: (error) => {
      console.error('❌ usePriceStream: WebSocket error:', error)
    },
    onClose: () => {
      console.warn('⚠️ usePriceStream: WebSocket closed')
    },
    enabled: wsEnabled,
  })

  // Store subscribe/unsubscribe functions in refs to avoid closure issues
  useEffect(() => {
    subscribeFnRef.current = subscribe
    unsubscribeFnRef.current = unsubscribe
  }, [subscribe, unsubscribe])

  // Subscribe/unsubscribe when symbols change (if already connected)
  useEffect(() => {
    console.log('🔄 Subscription effect triggered. isConnected:', isConnected, '| symbols:', symbols.length)
    if (isConnected && performSubscriptionRef.current) {
      console.log('✅ WebSocket connected, executing subscription...')
      performSubscriptionRef.current()
    } else if (!isConnected) {
      console.log('⏳ Waiting for WebSocket connection before subscribing...')
    } else if (!performSubscriptionRef.current) {
      console.warn('⚠️ performSubscriptionRef.current is not available')
    }
  }, [isConnected, symbols.join(',')])

  return {
    prices,
    isConnected,
  }
}

// Hook for a single symbol price
export function useSymbolPrice(symbol: string | null) {
  const [price, setPrice] = useState<PriceData | null>(null)
  const symbolRef = useRef<string | null>(symbol)

  // Update ref when symbol changes
  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  useEffect(() => {
    if (!symbol) {
      setPrice(null)
      return
    }

    const symbolUpper = symbol.toUpperCase().trim()
    if (!symbolUpper) {
      console.warn(`⚠️ useSymbolPrice: Empty symbol after processing`)
      setPrice(null)
      return
    }

    console.log(`🔔 useSymbolPrice("${symbol}") -> "${symbolUpper}" subscribing...`)
    console.log(`🔔 Current price store keys:`, Array.from(priceStore.keys()))
    console.log(`🔔 Current subscriber keys:`, Array.from(subscribers.keys()))

    // Create a stable callback function that checks the current symbol ref
    const priceCallback = (newPrice: PriceData) => {
      // Only update if this callback is still for the current symbol
      const currentSymbol = symbolRef.current
      const currentSymbolUpper = currentSymbol ? currentSymbol.toUpperCase().trim() : null
      if (currentSymbolUpper === symbolUpper) {
        console.log(`💰 useSymbolPrice(${symbolUpper}) received price update:`, newPrice)
        setPrice(newPrice)
      } else {
        console.log(`⏭️ useSymbolPrice(${symbolUpper}) ignoring price - symbol changed to: ${currentSymbol} (${currentSymbolUpper})`)
      }
    }

    // Subscribe FIRST before checking for initial price
    if (!subscribers.has(symbolUpper)) {
      subscribers.set(symbolUpper, new Set())
      console.log(`🆕 Created subscriber set for ${symbolUpper}`)
    }
    const callbacks = subscribers.get(symbolUpper)!
    callbacks.add(priceCallback)
    console.log(`✅ Added price subscriber for ${symbolUpper}, total subscribers: ${callbacks.size}`)

    // Set initial price if available (check AFTER subscribing)
    const initialPrice = priceStore.get(symbolUpper)
    if (initialPrice) {
      console.log(`💰 Initial price found for ${symbolUpper}:`, initialPrice)
      setPrice(initialPrice)
    } else {
      console.log(`⚠️ No initial price found for ${symbolUpper}. Price store has:`, Array.from(priceStore.keys()))
      console.log(`⚠️ Will wait for price update from WebSocket...`)
    }

    return () => {
      const callbacks = subscribers.get(symbolUpper)
      if (callbacks) {
        const removed = callbacks.delete(priceCallback)
        console.log(`🗑️ Cleanup: Removed subscriber for ${symbolUpper}, removed: ${removed}, remaining: ${callbacks.size}`)
        if (callbacks.size === 0) {
          subscribers.delete(symbolUpper)
          console.log(`🗑️ Cleanup: Deleted empty subscriber set for ${symbolUpper}`)
        }
      } else {
        console.log(`🗑️ Cleanup: No subscriber set found for ${symbolUpper}`)
      }
    }
  }, [symbol])

  return price
}

