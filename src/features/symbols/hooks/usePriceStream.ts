import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { priceStreamClient, getDataProviderPricesBaseUrl } from '@/shared/ws/priceStreamClient'
import { useAuthStore } from '@/shared/store/auth.store'
import { normalizeSymbolKey } from '@/shared/utils/symbolKeyNormalize'

interface PriceData {
  bid: string
  ask: string
  ts: number
}

// Global price store to avoid re-renders
const priceStore = new Map<string, PriceData>()

// Subscribers map: symbol -> Set of callbacks
const subscribers = new Map<string, Set<(price: PriceData) => void>>()

export { normalizeSymbolKey }

function notifySubscribers(symbol: string, price: PriceData) {
  const symbolUpper = symbol.toUpperCase().trim()
  const normalizedKey = normalizeSymbolKey(symbolUpper)
  priceStore.set(normalizedKey, price)

  let callbacks = subscribers.get(normalizedKey) ?? subscribers.get(symbolUpper)
  if (callbacks?.size) {
    const copy = Array.from(callbacks)
    copy.forEach((cb) => { try { cb(price) } catch (_) {} })
  }
}

export function usePriceStream(symbols: string[]) {
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map())
  const callbackRef = useRef<(symbol: string, price: PriceData) => void>()
  const subscribedSymbolsRef = useRef<Set<string>>(new Set())
  const symbolsRef = useRef<string[]>([])
  const subscribeFnRef = useRef<((symbols: string[]) => boolean) | null>(null)
  const unsubscribeFnRef = useRef<((symbols: string[]) => void) | null>(null)

  const symbolsKey = useMemo(
    () => symbols.map((s) => s.toUpperCase().trim()).filter((s) => s.length > 0).join(','),
    [symbols]
  )

  // Update symbols ref when they change
  useEffect(() => {
    symbolsRef.current = symbols.map((s) => s.toUpperCase().trim()).filter((s) => s.length > 0)
  }, [symbolsKey])

  // Create callback that updates only the specific symbol - use useCallback to ensure stability
  const updatePrice = useCallback((symbol: string, price: PriceData) => {
    setPrices((prev) => {
      const next = new Map(prev)
      next.set(symbol, price)
      return next
    })
  }, [])

  // Set the callback ref
  useEffect(() => {
    callbackRef.current = updatePrice
  }, [updatePrice])

  // Function to perform subscription (data-provider WS, no auth)
  const performSubscriptionRef = useRef<() => void>()
  
  performSubscriptionRef.current = () => {
    const symbolsUpper = symbolsRef.current
    const subscribeFn = subscribeFnRef.current
    const unsubscribeFn = unsubscribeFnRef.current
    
    if (symbolsUpper.length === 0) return
    if (!subscribeFn || !unsubscribeFn) return

    const symbolsToSubscribe = symbolsUpper.filter(s => !subscribedSymbolsRef.current.has(s))
    const symbolsToUnsubscribe = Array.from(subscribedSymbolsRef.current).filter(s => !symbolsUpper.includes(s))

    if (symbolsToUnsubscribe.length > 0) {
      unsubscribeFn(symbolsToUnsubscribe)
      symbolsToUnsubscribe.forEach(s => subscribedSymbolsRef.current.delete(s))
    }

    if (symbolsToSubscribe.length > 0) {
      const MAX = 50
      for (let i = 0; i < symbolsToSubscribe.length; i += MAX) {
        const batch = symbolsToSubscribe.slice(i, i + MAX)
        if (subscribeFn(batch)) batch.forEach(s => subscribedSymbolsRef.current.add(s))
      }
    }
  }

  // Register subscribers for each symbol so we can push prices into React state
  useEffect(() => {
    const symbolsUpper = symbols.map(s => s.toUpperCase().trim()).filter(s => s.length > 0)
    const wrappedCallbacks = new Map<string, (price: PriceData) => void>()

    symbolsUpper.forEach((symbol) => {
      const normalizedSymbol = normalizeSymbolKey(symbol)
      if (!subscribers.has(normalizedSymbol)) subscribers.set(normalizedSymbol, new Set())
      const callbacks = subscribers.get(normalizedSymbol)!

      const wrappedCallback = (price: PriceData) => {
        updatePrice(normalizedSymbol, price)
      }
      wrappedCallbacks.set(symbol, wrappedCallback)
      callbacks.add(wrappedCallback)

      const initialPrice = priceStore.get(normalizedSymbol)
      if (initialPrice) wrappedCallback(initialPrice)
    })

    return () => {
      symbolsUpper.forEach((symbol) => {
        const normalizedSymbol = normalizeSymbolKey(symbol)
        const callbacks = subscribers.get(normalizedSymbol)
        const wrappedCallback = wrappedCallbacks.get(symbol)
        if (callbacks && wrappedCallback) {
          callbacks.delete(wrappedCallback)
          if (callbacks.size === 0) {
            subscribers.delete(normalizedSymbol)
          }
        }
      })
    }
  }, [symbolsKey, updatePrice]) // Include updatePrice in dependencies

  const [isConnected, setIsConnected] = useState(priceStreamClient.isConnected())

  // Sync connection state
  useEffect(() => {
    const interval = setInterval(() => {
      setIsConnected((prev) => {
        const next = priceStreamClient.isConnected()
        return next !== prev ? next : prev
      })
    }, 500)
    return () => clearInterval(interval)
  }, [])

  // Sync auth token so gateway accepts subscribe (gateway requires auth first)
  const accessToken = useAuthStore((s) => s.accessToken)
  const accessTokenRef = useRef<string | null>(null)
  useEffect(() => {
    priceStreamClient.setAuthToken(accessToken)
  }, [accessToken])

  // Listen to ticks from gateway or data-provider
  useEffect(() => {
    const unsub = priceStreamClient.onTick((tick) => {
      notifySubscribers(tick.symbol, { bid: tick.bid, ask: tick.ask, ts: tick.ts })
    })
    return unsub
  }, [])

  // Subscribe/unsubscribe via data-provider client
  const subscribeToSymbols = useCallback((symbolsToSubscribe: string[]) => {
    priceStreamClient.subscribe(symbolsToSubscribe)
    setIsConnected(priceStreamClient.isConnected())
    return true
  }, [])

  const unsubscribeFromSymbols = useCallback((symbolsToUnsubscribe: string[]) => {
    priceStreamClient.unsubscribe(symbolsToUnsubscribe)
  }, [])

  // Store subscribe/unsubscribe functions in refs
  useEffect(() => {
    subscribeFnRef.current = subscribeToSymbols
    unsubscribeFnRef.current = unsubscribeFromSymbols
  }, [subscribeToSymbols, unsubscribeFromSymbols])

  // Server-side snapshot: raw data-provider `/prices` only when logged out. Logged-in users get marked-up bids/asks from gateway WS only.
  useEffect(() => {
    if (accessToken) return
    const base = getDataProviderPricesBaseUrl()
    if (!base || symbols.length === 0) return
    const symbolsParam = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)
    if (symbolsParam.length === 0) return
    const url = `${base}/prices?symbols=${encodeURIComponent(symbolsParam.join(','))}`
    let cancelled = false
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((arr: Array<{ symbol: string; bid: string; ask: string; ts: number }> | null) => {
        if (cancelled || !Array.isArray(arr)) return
        arr.forEach((item) => {
          notifySubscribers(item.symbol, { bid: item.bid, ask: item.ask, ts: item.ts })
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [symbolsKey, accessToken])

  // Logged in: group-marked prices from auth (same Redis keys the gateway uses). Fills the map on
  // full page reload before the WebSocket finishes auth + subscribe (browsers cannot keep WS open across refresh).
  useEffect(() => {
    if (!accessToken) return
    if (symbols.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        const { fetchTerminalPricesSnapshot } = await import(
          '@/features/terminal/api/terminalPrices.api'
        )
        const list = await fetchTerminalPricesSnapshot(symbols)
        if (cancelled) return
        for (const item of list) {
          notifySubscribers(item.symbol, { bid: item.bid, ask: item.ask, ts: item.ts })
        }
      } catch {
        // WebSocket will catch up
      }
    })()
    return () => {
      cancelled = true
    }
  }, [symbolsKey, accessToken])

  // Subscribe when symbols change; re-push subscribe when access token appears/changes so gateway streams are not stuck after login
  useEffect(() => {
    if (symbols.length === 0) return
    if (performSubscriptionRef.current) {
      performSubscriptionRef.current()
    }
  }, [symbolsKey])

  useEffect(() => {
    if (!accessToken || symbols.length === 0) return
    const prev = accessTokenRef.current
    accessTokenRef.current = accessToken
    if (prev !== accessToken) {
      priceStreamClient.resyncSymbolSubscriptions(symbolsRef.current)
    }
  }, [accessToken, symbolsKey])

  const triggerResubscribe = useCallback(() => {
    if (performSubscriptionRef.current && symbolsRef.current.length > 0) {
      performSubscriptionRef.current()
    }
    priceStreamClient.resyncSymbolSubscriptions(symbolsRef.current)
  }, [])

  return {
    prices,
    isConnected,
    triggerResubscribe,
  }
}

/**
 * Subscribe to the price stream for the given symbols and return only connection status.
 * Does NOT register any price callback, so the component using this hook will not re-render
 * when prices change. Use this in tables/lists so only the individual PriceCell (useSymbolPrice)
 * components re-render on tick.
 */
export function usePriceStreamConnection(symbols: string[]) {
  const subscribedSymbolsRef = useRef<Set<string>>(new Set())
  const symbolsRef = useRef<string[]>([])
  const subscribeFnRef = useRef<((symbols: string[]) => boolean) | null>(null)
  const unsubscribeFnRef = useRef<((symbols: string[]) => void) | null>(null)
  const accessTokenRef = useRef<string | null>(null)

  const symbolsKey = useMemo(
    () => symbols.map((s) => s.toUpperCase().trim()).filter((s) => s.length > 0).join(','),
    [symbols]
  )

  useEffect(() => {
    symbolsRef.current = symbols.map((s) => s.toUpperCase().trim()).filter((s) => s.length > 0)
  }, [symbolsKey])

  const performSubscriptionRef = useRef<() => void>()
  performSubscriptionRef.current = () => {
    const symbolsUpper = symbolsRef.current
    const subscribeFn = subscribeFnRef.current
    const unsubscribeFn = unsubscribeFnRef.current
    if (symbolsUpper.length === 0) return
    if (!subscribeFn || !unsubscribeFn) return
    const symbolsToSubscribe = symbolsUpper.filter((s) => !subscribedSymbolsRef.current.has(s))
    const symbolsToUnsubscribe = Array.from(subscribedSymbolsRef.current).filter((s) => !symbolsUpper.includes(s))
    if (symbolsToUnsubscribe.length > 0) {
      unsubscribeFn(symbolsToUnsubscribe)
      symbolsToUnsubscribe.forEach((s) => subscribedSymbolsRef.current.delete(s))
    }
    if (symbolsToSubscribe.length > 0) {
      const MAX = 50
      for (let i = 0; i < symbolsToSubscribe.length; i += MAX) {
        const batch = symbolsToSubscribe.slice(i, i + MAX)
        if (subscribeFn(batch)) batch.forEach((s) => subscribedSymbolsRef.current.add(s))
      }
    }
  }

  const [isConnected, setIsConnected] = useState(priceStreamClient.isConnected())
  useEffect(() => {
    const interval = setInterval(() => {
      setIsConnected((prev) => {
        const next = priceStreamClient.isConnected()
        return next !== prev ? next : prev
      })
    }, 500)
    return () => clearInterval(interval)
  }, [])

  const accessToken = useAuthStore((s) => s.accessToken)
  useEffect(() => {
    priceStreamClient.setAuthToken(accessToken)
  }, [accessToken])

  useEffect(() => {
    const unsub = priceStreamClient.onTick((tick) => {
      notifySubscribers(tick.symbol, { bid: tick.bid, ask: tick.ask, ts: tick.ts })
    })
    return unsub
  }, [])

  const subscribeToSymbols = useCallback((symbolsToSubscribe: string[]) => {
    priceStreamClient.subscribe(symbolsToSubscribe)
    setIsConnected(priceStreamClient.isConnected())
    return true
  }, [])

  const unsubscribeFromSymbols = useCallback((symbolsToUnsubscribe: string[]) => {
    priceStreamClient.unsubscribe(symbolsToUnsubscribe)
  }, [])

  useEffect(() => {
    subscribeFnRef.current = subscribeToSymbols
    unsubscribeFnRef.current = unsubscribeFromSymbols
  }, [subscribeToSymbols, unsubscribeFromSymbols])

  useEffect(() => {
    if (accessToken) return
    const base = getDataProviderPricesBaseUrl()
    if (!base || symbols.length === 0) return
    const symbolsParam = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)
    if (symbolsParam.length === 0) return
    const url = `${base}/prices?symbols=${encodeURIComponent(symbolsParam.join(','))}`
    let cancelled = false
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((arr: Array<{ symbol: string; bid: string; ask: string; ts: number }> | null) => {
        if (cancelled || !Array.isArray(arr)) return
        arr.forEach((item) => {
          notifySubscribers(item.symbol, { bid: item.bid, ask: item.ask, ts: item.ts })
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [symbolsKey, accessToken])

  useEffect(() => {
    if (!accessToken) return
    if (symbols.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        const { fetchTerminalPricesSnapshot } = await import(
          '@/features/terminal/api/terminalPrices.api'
        )
        const list = await fetchTerminalPricesSnapshot(symbols)
        if (cancelled) return
        for (const item of list) {
          notifySubscribers(item.symbol, { bid: item.bid, ask: item.ask, ts: item.ts })
        }
      } catch {
        // WebSocket will catch up
      }
    })()
    return () => {
      cancelled = true
    }
  }, [symbolsKey, accessToken])

  useEffect(() => {
    if (symbols.length === 0) return
    if (performSubscriptionRef.current) performSubscriptionRef.current()
  }, [symbolsKey])

  useEffect(() => {
    if (!accessToken || symbols.length === 0) return
    const prev = accessTokenRef.current
    accessTokenRef.current = accessToken
    if (prev !== accessToken) {
      priceStreamClient.resyncSymbolSubscriptions(symbolsRef.current)
    }
  }, [accessToken, symbolsKey])

  const triggerResubscribe = useCallback(() => {
    if (performSubscriptionRef.current && symbolsRef.current.length > 0) performSubscriptionRef.current()
    priceStreamClient.resyncSymbolSubscriptions(symbolsRef.current)
  }, [])

  return { isConnected, triggerResubscribe }
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

    // Normalize symbol key to match incoming price format
    const normalizedSymbol = normalizeSymbolKey(symbolUpper)
    
    // Subscribe FIRST before checking for initial price
    if (!subscribers.has(normalizedSymbol)) {
      subscribers.set(normalizedSymbol, new Set())
      console.log(`🆕 Created subscriber set for ${symbolUpper} (normalized: ${normalizedSymbol})`)
    }
    const callbacks = subscribers.get(normalizedSymbol)!
    callbacks.add(priceCallback)
    console.log(`✅ Added price subscriber for ${symbolUpper} (normalized: ${normalizedSymbol}), total subscribers: ${callbacks.size}`)

    // Set initial price if available (check AFTER subscribing, use normalized key)
    const initialPrice = priceStore.get(normalizedSymbol)
    if (initialPrice) {
      console.log(`💰 Initial price found for ${normalizedSymbol}:`, initialPrice)
      setPrice(initialPrice)
    } else {
      console.log(`⚠️ No initial price found for ${normalizedSymbol}. Price store has:`, Array.from(priceStore.keys()))
      console.log(`⚠️ Will wait for price update from WebSocket...`)
    }

    return () => {
      const callbacks = subscribers.get(normalizedSymbol)
      if (callbacks) {
        const removed = callbacks.delete(priceCallback)
        console.log(`🗑️ Cleanup: Removed subscriber for ${normalizedSymbol}, removed: ${removed}, remaining: ${callbacks.size}`)
        if (callbacks.size === 0) {
          subscribers.delete(normalizedSymbol)
          console.log(`🗑️ Cleanup: Deleted empty subscriber set for ${normalizedSymbol}`)
        }
      } else {
        console.log(`🗑️ Cleanup: No subscriber set found for ${symbolUpper}`)
      }
    }
  }, [symbol])

  return price
}

