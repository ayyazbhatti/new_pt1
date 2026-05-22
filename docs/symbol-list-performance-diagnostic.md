# Symbol list performance diagnostic (read-only)

**Scope:** Trace live BID/ASK from data providers through Redis → `ws-gateway` → browser → Zustand/React for the terminal symbol list (`LeftSidebar`, `TerminalSymbolsPage`). **No code or DB changes** were made.

**Dev Redis check (2026-05-22, local `127.0.0.1:6379`):**

- `PUBSUB CHANNELS '*'` listed multiple channels including **`price:ticks`** (no per-symbol `ticks:*` channels).
- `PUBSUB CHANNELS 'tick*'` → empty.
- `PUBSUB CHANNELS 'price*'` → **`price:ticks`** only.
- `PUBSUB NUMSUB price:ticks` → **2** subscribers (typical: e.g. `ws-gateway` + another consumer).

---

## Step 1 — Data provider tick rates

### `apps/data-provider` (Binance REST)

| Question | Finding |
|----------|---------|
| Fetch interval | **`interval(Duration::from_millis(500))`** → **~2 requests/sec per symbol**. |
| Symbols at once | **12** internal symbols (`BTCUSD` … `ATOMUSD`), each in its **own** `tokio::spawn` loop (one Binance `bookTicker` URL per task). |
| Publish path | **NATS** subject `ticks.{binance_symbol}`; **Redis** `PUBLISH "price:ticks", <json>`. |
| Dedup | **No** “only if bid/ask changed” before publish; every successful parse updates `last_ticks`, publishes NATS, and (if Redis configured) publishes to **`price:ticks`**. |

```197:271:apps/data-provider/src/main.rs
    let mut interval = interval(Duration::from_millis(500)); // Fetch every 500ms (2 times per second)
    // ...
                                        if let Ok(json) = serde_json::to_string(&payload) {
                                            if let Ok(mut conn) = rd.get_async_connection().await {
                                                let _: Result<(), _> = conn.publish("price:ticks", &json).await;
                                            }
                                        }
```

**Rough publish rate (this binary alone):** up to **~24 Redis messages/sec** to `price:ticks` (12 × 2), plus NATS per tick.

### `backend/data-provider` (MMDPS + broadcast loop)

| Question | Finding |
|----------|---------|
| MMDPS input | **WebSocket push** — `connect_async`, subscribe with `{"action":"subscribe","symbols":[...]}` in **chunks of 200**. |
| Downstream publish | **100 ms** `tokio::time::interval` loop over **all subscribed symbols**; reads `feed.get_price(symbol)`. **Dedup:** skips Redis/NATS publish if raw `(bid, ask)` equals last published for that symbol (`last_feed_published`). Comment: *“skip redundant 100ms republishes when unchanged”*. |
| Redis | **`publish_price_update("price:ticks", &tick_json.to_string())`** with JSON `{ symbol, ts, prices: [ { g, bid, ask }, ... ] }` (per price group when groups exist). |
| NATS | When configured: `ticks.{symbol}` if no groups, else **`ticks.{symbol}.{group_id}`** per group. |

```1:4:backend/data-provider/src/feeds/mmdps_feed.rs
//! MMDPS WebSocket feed (forex/CFD symbols). Uses same [`PriceState`] as Binance for downstream compatibility.
//!
//! Protocol: connect to `wss://.../feed/ws?api_key=...`, send `{"action":"subscribe","symbols":[...]}`,
//! receive `{"type":"tick","symbol","bid","ask",...}`.
```

```109:131:backend/data-provider/src/feeds/mmdps_feed.rs
        /// Large subscribe payloads can exceed WS frame limits; chunk symbol lists.
        const CHUNK: usize = 200;
        // ...
                let payload = serde_json::json!({
                    "action": "subscribe",
                    "symbols": chunk,
                });
```

```454:556:backend/data-provider/src/main.rs
    // Price update loop — per-group: one Redis message with prices[], per-group NATS, per-group WS
    // ...
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            // ...
                if let Some(price_state) = feed_clone.get_price(symbol).await {
                    let raw = (price_state.bid, price_state.ask);
                    {
                        let last = last_feed_dedup.read().await;
                        if last.get(symbol).copied() == Some(raw) {
                            continue;
                        }
                    }
                    // ... build tick_json ...
                    if let Err(e) = redis_for_pubsub_clone
                        .publish_price_update("price:ticks", &tick_json.to_string())
                        .await
```

**Per-symbol tick rate to Redis:** **≤10 Hz** when bid/ask keep changing (100 ms loop); **0** between changes after dedup. **Catalog size:** dynamic via `subscribed_symbols` + catalog refresh (Postgres); initial list can be large from env defaults in `main.rs`.

---

## Step 2 — Redis / NATS hop

- **Single Redis pub/sub channel for all tick JSON:** **`price:ticks`** (not `ticks:{symbol}` per channel from these publishers).
- **Implication:** Every `ws-gateway` (or other) instance subscribed to `price:ticks` receives **every** tick message; fan-out to **browser clients** is decided later in the gateway (see Step 3).
- **NATS:** per-symbol (`ticks.{symbol}`) or per-symbol-per-group subjects from `backend/data-provider`; `apps/data-provider` uses `ticks.{binance_symbol}`. **`ws-gateway` in this repo consumes ticks from Redis** (`main.rs` channel list), not NATS, for `price:ticks`.

```88:90:backend/ws-gateway/src/main.rs
    let redis_channels = vec![
        "price:ticks".to_string(),
```

---

## Step 3 — `ws-gateway` fan-out

**Ingress:** Redis pub/sub → `RedisSubscriber` → internal broadcast → `Broadcaster::handle_message` for channel `"price:ticks"`.

**Egress:** **`broadcast_tick`** resolves `registry.get_symbol_subscribers(symbol)` (plus USDT→USD alias merge), then **`try_send`** a `ServerMessage::Tick` **only to those connection IDs** — **not** a blind “every client gets every tick”.

```144:176:backend/ws-gateway/src/stream/broadcaster.rs
    async fn broadcast_tick(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::Sender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let symbol = payload
            .get("symbol")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing symbol in tick"))?;
        // ...
        let mut subscriber_ids: Vec<Uuid> = registry.get_symbol_subscribers(symbol).into_iter().collect();
        if symbol.ends_with("USDT") {
            let symbol_usd = format!("{}USD", symbol.trim_end_matches("USDT"));
            for id in registry.get_symbol_subscribers(&symbol_usd) {
                if !subscriber_ids.contains(&id) {
                    subscriber_ids.push(id);
                }
            }
        }
```

**Client subscription model:** WebSocket `ClientMessage::Subscribe { symbols, channels }` → `ConnectionRegistry::subscribe_symbol` maintains **`symbol_subscribers: symbol → Vec<conn_id>`**.

```263:271:backend/ws-gateway/src/ws/session.rs
                            ClientMessage::Subscribe { symbols, channels } => {
                                // Check if authenticated
                                if registry.get(&conn_id).is_some() {
                                    let mut normalized_symbols: Vec<String> = Vec::with_capacity(symbols.len());
                                    for symbol in &symbols {
                                        if let Some(normalized) = normalize_subscription_symbol(symbol) {
                                            if !normalized_symbols.contains(&normalized) {
                                                registry.subscribe_symbol(conn_id, normalized.clone(), channels.clone());
```

```84:93:backend/ws-gateway/src/state/connection_registry.rs
    pub fn subscribe_symbol(&self, conn_id: Uuid, symbol: String, channels: Vec<String>) {
        if let Some(mut conn) = self.connections.get_mut(&conn_id) {
            conn.subscriptions.insert(symbol.clone(), channels);
            conn.last_heartbeat = std::time::Instant::now();

            // Add to symbol subscribers
            self.symbol_subscribers
                .entry(symbol)
                .or_insert_with(Vec::new)
                .push(conn_id);
        }
    }
```

**Back-pressure:** Per-connection outbound queue cap **`WS_CONN_CHANNEL_CAP = 4096`**; **full queue drops ticks** (`TrySendError::Full` on `Tick`).

```10:31:backend/ws-gateway/src/stream/broadcaster.rs
/// Max queued outbound messages per WebSocket. Slow clients cannot grow memory without bound;
/// price ticks are safe to drop when the queue is full.
pub const WS_CONN_CHANNEL_CAP: usize = 4096;
// ...
        Err(TrySendError::Full(m)) => {
            if matches!(m, ServerMessage::Tick { .. }) {
                // expected under high tick rate
```

**Verdict:** **Per-client subscription state** — **not** Bottleneck **C** (broadcast-all). Redis **single channel** still means **B** can matter for **gateway replicas** and **CPU parsing** volume.

---

## Step 4 — Tick message size (wire)

**Shape (gateway → browser):** `ServerMessage::Tick` serializes as JSON with **`type: "tick"`**, `symbol`, `bid`, `ask`, `ts` (strings for bid/ask per protocol).

```52:59:backend/ws-gateway/src/ws/protocol.rs
    #[serde(rename = "tick")]
    Tick {
        symbol: String,
        bid: String,
        ask: String,
        ts: i64,
    },
```

**Redis `price:ticks` payload (backend):** larger — includes `prices` array when multiple markup groups exist.

**Estimate:** one WS tick line often **~120–220 bytes** UTF-8 depending on symbol length and decimal width. **No live 30s `wscat` capture** in this run (auth); use DevTools → WS frames in a logged-in session to measure **fps** and byte length empirically.

---

## Step 5 — Frontend store / render

### WebSocket client for **prices**

Terminal uses **`priceStreamClient`** (`src/shared/ws/priceStreamClient.ts`), not `wsClient`, for tick subscription and `onTick` dispatch. Ticks call all registered listeners.

```282:288:src/shared/ws/priceStreamClient.ts
          if (data.type === 'tick' && data.symbol) {
            const bid = typeof data.bid === 'number' ? String(data.bid) : (data.bid ?? '')
            const ask = typeof data.ask === 'number' ? String(data.ask) : (data.ask ?? '')
            const tick: PriceTick = { symbol: data.symbol, bid, ask, ts: data.ts ?? 0 }
            this.listeners.forEach((fn) => {
              try { fn(tick) } catch (_) {}
            })
          }
```

**Note:** `src/shared/ws/wsClient.ts` logs every tick in dev (`console.log` on `data.type === 'tick'`), which can add **main-thread overhead** if that client is also connected.

```136:137:src/shared/ws/wsClient.ts
          if (data.type === 'tick') {
            console.log('📨 [wsClient] Tick received:', (data as any).symbol, 'handlers=', this.handlers.size)
```

### Price hook + shell integration (**critical path**)

`usePriceStream` maintains React state `prices` as a **`Map`**. On **each** tick for a subscribed symbol it does **`new Map(prev)`** and `set` — **new `Map` reference every time**.

```51:56:src/features/symbols/hooks/usePriceStream.ts
  const updatePrice = useCallback((symbol: string, price: PriceData) => {
    setPrices((prev) => {
      const next = new Map(prev)
      next.set(symbol, price)
      return next
    })
  }, [])
```

`AppShellTerminal` depends on **`priceMap`** and on **every change** remaps **all** admin symbols into `MockSymbol[]` and calls **`setSymbols(mappedSymbols)`** — updating the **entire** `symbols` array in Zustand.

```143:151:src/features/terminal/pages/AppShellTerminal.tsx
  useEffect(() => {
    if (symbolsData?.items) {
      const mappedSymbols = symbolsData.items.map((symbol) =>
        mapSymbolToTerminal(symbol, priceMap)
      )
      setSymbols(mappedSymbols)
    }
  }, [symbolsData, priceMap, setSymbols])
```

`setSymbols` always **`set({ symbols })`** and, when a symbol is selected, **updates `selectedSymbol`** to the new object reference — amplifying downstream updates.

```163:176:src/features/terminal/store/terminalStore.ts
  setSymbols: (symbols) => {
    const state = get()
    const currentSelectedId = state.selectedSymbol?.id
    
    set({ symbols })
    
    // If we have a currently selected symbol, check if it still exists in the new symbols list
    if (currentSelectedId) {
      const stillExists = symbols.find((s) => s.id === currentSelectedId)
      if (stillExists) {
        // Update the selected symbol with the latest data (prices may have changed)
        set({ selectedSymbol: stillExists })
        return
      }
```

**Contrast:** The codebase already documents a lighter pattern — **`usePriceStreamConnection`** + **`useSymbolPrice`** per row — *“Use this in tables/lists so only the individual PriceCell … re-renders on tick.”* **`AppShellTerminal` does not use it** for the symbol list path.

```251:255:src/features/symbols/hooks/usePriceStream.ts
 * Subscribe to the price stream for the given symbols and return only connection status.
 * Does NOT register any price callback, so the component using this hook will not re-render
 * when prices change. Use this in tables/lists so only the individual PriceCell (useSymbolPrice)
 * components re-render on tick.
```

### `LeftSidebar` / `TerminalSymbolsPage`

- **`LeftSidebar`:** `useTerminalStore()` **without a selector** — **any** terminal store update re-renders the sidebar. Rows read **`symbol.numericPrice`** / **`symbol.numericPrice2`** from the big `symbols` list, not `useSymbolPrice`.

```52:72:src/features/terminal/components/LeftSidebar.tsx
export function LeftSidebar({ onOpenDeposit }: LeftSidebarProps = {}) {
  const {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    watchlist,
    toggleWatchlist,
    selectedSymbol,
    setSelectedSymbol,
    getFilteredSymbols,
    isLoading,
    // ...
  } = useTerminalStore()
```

```629:634:src/features/terminal/components/LeftSidebar.tsx
                            <PriceDisplay
                              bid={symbol.numericPrice}
                              ask={symbol.numericPrice2}
                              bidFormatted={symbol.price}
                              askFormatted={symbol.price2}
                            />
```

- **`TerminalSymbolsPage`:** Same pattern — **destructured `useTerminalStore()`** including **`symbols: allSymbols`**.

```34:46:src/features/terminal/components/TerminalSymbolsPage.tsx
  const {
    getFilteredSymbols,
    symbols: allSymbols,
    setSelectedSymbol,
    setSearchQuery,
    searchQuery,
    setActiveTab,
    watchlist,
    toggleWatchlist,
    selectedSymbol,
    isLoading,
    activeTab,
  } = useTerminalStore()
```

### Virtualization / memo

- **No** `react-window`, `react-virtual`, or `@tanstack/react-virtual` under `src/features/terminal` (grep).
- **`PriceDisplay`** is a normal function component — **not** wrapped in `React.memo` in its file.

### Minor: “connection polling” in price hook

`usePriceStream` / `usePriceStreamConnection` use **`setInterval(..., 500)`** only to mirror `isConnected` — not price data polling, but worth noting for profiler noise.

```130:137:src/features/symbols/hooks/usePriceStream.ts
  useEffect(() => {
    const interval = setInterval(() => {
      setIsConnected((prev) => {
        const next = priceStreamClient.isConnected()
        return next !== prev ? next : prev
      })
    }, 500)
    return () => clearInterval(interval)
  }, [])
```

---

## Step 6 — React DevTools Profiler

**Not run** in this diagnostic session. Recommended: record 10s of live quotes and rank commits for **`LeftSidebar`**, **`TerminalSymbolsPage`**, **`AppShellTerminal`**, **`PriceDisplay`**.

---

## Step 7 — Memory growth (code review)

| Area | Risk | Evidence |
|------|------|----------|
| Tick history unbounded | **Low** for ticks | No `ticks[]` push found on terminal price path; `priceStore` is a **`Map` of latest quote per symbol**. |
| `useSymbolPrice` logging | **Dev-only churn** | Heavy `console.log` on subscribe/update/cleanup — can allocate strings and hurt performance when many cells mount. |
| Full symbol array replace | **GC pressure** | Every tick → new `Map` → `setSymbols` **new array** of length N — many short-lived objects. |
| Chart closed markers | **Bounded** | `getClosedPositions({ limit: 100 })` + merge by id — not unbounded tick buffer. |

```378:386:src/features/terminal/components/ChartPlaceholder.tsx
    getClosedPositions({ limit: 100 })
      .then((closed) => {
        setPositions((prev) => {
          const openOnly = prev.filter((p) => p.status !== 'OPEN')
          const merged = [...openOnly]
          for (const c of closed) {
            if (!merged.some((p) => p.id === c.id)) merged.push(c)
          }
          return merged
        })
      })
```

---

## Step 8 — End-to-end latency

**Not measured** here (needs DevTools WS timestamps vs UI paint). **Inference:** If server timestamps in ticks track wall clock but the UI stutters, combined with **full-store remapping** on each tick, lag is likely **downstream (React/Zustand)** rather than provider-only.

---

## Step 9 — Bottleneck classification (A–G)

| ID | Label | Supported? | Evidence |
|----|-------|--------------|----------|
| **A** | Data provider rate-limited | **Partial** | Binance app path ~2 Hz/symbol; backend path ≤10 Hz/symbol with dedup. Can aggregate high **Redis** message volume for many **moving** symbols but not the full-list React pattern. |
| **B** | Redis/NATS fan-out | **Partial** | Single Redis channel **`price:ticks`** — every consumer process sees all ticks; cost scales with **total market tick rate × replicas**. |
| **C** | `ws-gateway` broadcast-all | **No** | `get_symbol_subscribers` + per-conn `try_send` — targeted. |
| **D** | WebSocket bandwidth | **Possible** under extreme aggregate Hz | Queue cap + **tick drops** when client slow. |
| **E** | Frontend store updates | **Yes (dominant)** | `new Map` per tick + **`setSymbols` for all symbols** on every `priceMap` change. |
| **F** | Frontend rendering | **Yes (dominant)** | `useTerminalStore()` without selectors; **no virtualization**; **~280+ DOM rows** always mounted for expanded sections. |
| **G** | DOM / list scale | **Yes (secondary)** | No virtual list; scaling toward **thousands** of visible rows will hurt even if store were fixed. |

**Dominant:** **E + F** (store propagates every tick to the entire symbol list; sidebar/mobile quotes subscribe to the whole store and re-render rows). **Supporting:** **G** for large visible lists; **B** when many symbols move simultaneously or multiple gateway consumers exist.

---

## Step 10 — Tiered fix plan (toward ~20k catalog, ~50 streams/user)

### Quick wins (hours–days; minimal architecture change)

| Change | Unlocks (rough) |
|--------|------------------|
| **`AppShellTerminal`:** use **`usePriceStreamConnection`** + per-row **`useSymbolPrice`** (or dedicated `PriceCell`) so ticks **do not** replace the whole `symbols` array. | **500–2k** subscribed symbols UI much smoother; list still O(N) DOM if all visible. |
| **Zustand selectors** in `LeftSidebar` / `TerminalSymbolsPage` (`useTerminalStore(s => …, shallow)`) to isolate price-unrelated state. | Fewer wasted re-renders from unrelated store fields. |
| **`React.memo`** on row / `PriceDisplay`; optional **RAF throttle** for bid/ask flash UI. | Cuts duplicate work per parent render. |
| **Virtualize** symbol list (`@tanstack/react-virtual` / `react-window`). | **1k–5k+** rows in scrollable panel without 1:1 DOM. |
| Remove/guard **`console.log`** in `useSymbolPrice` and `wsClient` tick paths for production. | Less main-thread and GC overhead. |

### Medium effort (days–weeks; single-system or protocol tweaks)

| Change | Unlocks (rough) |
|--------|------------------|
| **Batch ticks** in gateway or client (e.g. `{ type: "ticks", items: [...] }` every 50–100ms). | Lower WS/JS event rate; smoother UI. |
| **Redis channel sharding** (e.g. `price:ticks:{shard}`) or **per-symbol** channels + gateway subscribe set keyed by union of client interests. | Reduces wasted ingress on multi-replica gateways. |
| **Server-side cap** on tick rate per symbol per group for non-HFT users. | Predictable load toward **5k–20k** catalog with sparse hot symbols. |

### Architectural (weeks–month; multi-system)

| Change | Unlocks (rough) |
|--------|------------------|
| **Snapshot + delta** (initial REST/snapshot, WS only deltas); **catalog vs watchlist** separation (20k metadata lazy; **50** live streams explicit). | **20k+** catalog, **bounded** live traffic per user. |
| **Horizontal scaling** of tick ingress with consistent sharding + **client routing** to correct shard. | Very large symbol universes with controlled fan-out. |

---

## Summary table

| Step | Headline |
|------|----------|
| 1 | Binance app: **500ms** poll/symbol; backend: **MMDPS WS** + **100ms** publish loop with **bid/ask dedup**; both use Redis **`price:ticks`**. |
| 2 | **One** Redis tick channel observed in dev; **`tick*`** had no extra channels. |
| 3 | Gateway: **per-symbol subscriber index**, not broadcast-all; ticks may **drop** if outbound queue full. |
| 4 | WS tick JSON small; Redis tick JSON can be larger (group array). |
| 5 | **Major:** full `symbols` refresh from **`priceMap`** + **unscoped** `useTerminalStore` + **no virtualization**. |
| 9 | **Dominant E/F**; support **B/G**; **not C**. |
| 10 | Quick wins → **~1k** symbols manageable in UI; medium → **multi-k** with bounded rates; architecture → **20k catalog** with **~50** live streams per user. |
