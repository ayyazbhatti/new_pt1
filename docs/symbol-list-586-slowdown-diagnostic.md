# Symbol list slowdown @ ~586 symbols — read-only diagnostic

**Context:** After scaling enabled symbols (~586 vs ~280), bid/ask in the terminal UI feel **very slow**. User reports **data-provider is healthy** and emitting for **500+** symbols; slowdown is **downstream**. **Phase 1** is described in `docs/phase-1-symbol-list-quick-wins.md`. This document **does not change code or services**; it records **evidence** from the repo, local tooling, and **manual steps** the user should run in the browser.

---

## Step 1 — Verify Phase 1 is in the codebase (1A)

Commands run from repo root:

```bash
grep -n "priceMap" src/features/terminal/pages/AppShellTerminal.tsx
grep -n "usePriceStreamConnection" src/features/terminal/pages/AppShellTerminal.tsx
grep -n "PriceCell" src/features/terminal/components/LeftSidebar.tsx
grep -n "useShallow" src/features/terminal/components/LeftSidebar.tsx
grep -n "useSymbolPrice" src/features/terminal/components/RightTradingPanel.tsx
```

### Results (evidence)

**`AppShellTerminal.tsx`**

- **`priceMap`:** no matches (catalog path does not depend on a React `priceMap`).
- **`usePriceStreamConnection`:** present at import line **19** and usage line **131**.

```19:19:src/features/terminal/pages/AppShellTerminal.tsx
import { usePriceStreamConnection, hasCachedPriceForAnySymbol, useSymbolPrice } from '@/features/symbols/hooks/usePriceStream'
```

```131:131:src/features/terminal/pages/AppShellTerminal.tsx
  const { isConnected, triggerResubscribe } = usePriceStreamConnection(symbolCodes)
```

Catalog remap (no `priceMap` in dependency array):

```144:150:src/features/terminal/pages/AppShellTerminal.tsx
  // Catalog / metadata only — not on every tick
  useEffect(() => {
    if (symbolsData?.items) {
      const mappedSymbols = symbolsData.items.map((symbol) => mapSymbolToTerminal(symbol, null))
      setSymbols(mappedSymbols)
    }
  }, [symbolsData, setSymbols])
```

**`LeftSidebar.tsx`**

- **`useShallow`:** line **6** (import), line **72** (filtered symbols).
- **`PriceCell`:** line **13** (import), line **627** (usage).

**`TerminalSymbolsPage.tsx`** (extra grep, same intent)

- `useShallow` at lines **4**, **36**; `PriceCell` at **7**, **262**.

**`RightTradingPanel.tsx`**

- **`useSymbolPrice`:** import line **39**, hook line **218** (with `selectedLiveKey` / live bid-ask).

### Verdict for 1A

**Phase 1 structural changes are present in the tree:** `usePriceStreamConnection` (not `usePriceStream`) in `AppShellTerminal`, `PriceCell` + `useShallow` in list UIs, `useSymbolPrice` in the trading panel. This does **not** prove the **built bundle** the user runs matches this tree (deploy/build gap) — only that **this repo** contains the expected code.

---

## Step 1B — Profiler (must be run in browser; not executed here)

**Gap:** Cursor cannot drive a logged-in session + React DevTools Profiler.

**Procedure for the user:**

1. Open the terminal in the browser, log in as a test user.
2. Ensure ~586 symbols enabled and prices visibly moving.
3. React DevTools → **Profiler** → **Record** → **15 s** of live activity → **Stop**.
4. **Ranked** view → report **top 5 components by commit count**.

**Interpretation (from Phase 1 design):**

| Observation | Meaning |
|-------------|---------|
| **`PriceCell` / `PriceDisplay`** high commits (10–200+ in 15s) | **Expected** — per-symbol cells own tick-driven state. |
| **`LeftSidebar` / `TerminalSymbolsPage` / `AppShellTerminal`** high commits (50+ in 15s) | **Unexpected** — suggests something still ties list/shell to tick cadence (selector instability, store field changing every tick, or a parent above `PriceCell` re-rendering). |

If profiler shows the second row, treat **Hypothesis A** (Phase 1 incomplete in practice) as live until proven otherwise.

---

## Step 2 — Subscriber / dispatch model (read-only code evidence)

### 2A — `priceStreamClient`: global tick listeners

The prompt assumed per-symbol maps on `priceStreamClient`; the implementation is a **single `Set<TickListener>`** — **every WebSocket tick invokes every registered listener**:

```124:130:src/shared/ws/priceStreamClient.ts
class PriceStreamClient {
  private ws: WebSocket | null = null
  private url: string
  private authToken: string | null = null
  private authenticated = false
  private listeners = new Set<TickListener>()
```

```282:288:src/shared/ws/priceStreamClient.ts
          if (data.type === 'tick' && data.symbol) {
            const bid = typeof data.bid === 'number' ? String(data.bid) : (data.bid ?? '')
            const ask = typeof data.ask === 'number' ? String(data.ask) : (data.ask ?? '')
            const tick: PriceTick = { symbol: data.symbol, bid, ask, ts: data.ts ?? 0 }
            this.listeners.forEach((fn) => {
              try { fn(tick) } catch (_) {}
            })
```

**Who registers `onTick` today (grep):**

| Location | Role |
|----------|------|
| `usePriceStream.ts` (~158) | `usePriceStream` hook |
| `usePriceStream.ts` (~321) | `usePriceStreamConnection` hook |
| `ChartPlaceholder.tsx` (~563) | Chart live bar / ask overlay |
| `useAdminTradingLivePrices.ts` | Admin (not terminal) |

**Terminal layout implication:** `AppShellTerminal` uses **`usePriceStreamConnection`**; **`BottomDock`** uses **`usePriceStream(positionSymbols)`** for open positions. Both hooks register **`priceStreamClient.onTick`** → **each inbound tick runs both handlers** (plus `ChartPlaceholder` when the chart tab is mounted).

Each handler calls **`notifySubscribers`** in `usePriceStream.ts`:

```29:38:src/features/symbols/hooks/usePriceStream.ts
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
```

**Per-symbol React subscriptions** live in `subscribers` (`Map<string, Set<callback>>`). Each mounted **`PriceCell` → `useSymbolPrice`** adds one callback for that symbol’s normalized key.

**Evidence-backed consequence at 586 symbols:**

- For **each** tick message for symbol **S**, if **two** `onTick` paths both call `notifySubscribers(S, …)` (e.g. `usePriceStreamConnection` + `usePriceStream` from `BottomDock`), **callbacks for S can run twice per WS message** (two sequential `notifySubscribers` calls, each iterating the same `Set`).

```256:257:src/features/terminal/components/BottomDock.tsx
  // Subscribe to live price stream for position symbols
  const { prices: livePrices } = usePriceStream(positionSymbols)
```

**Browser console note:** `listeners` on `PriceStreamClient` is **`private`** — DevTools cannot call `priceStreamClient.listeners.size` without exposing it. To count **symbol** callbacks, you’d need a temporary dev export or logging in `notifySubscribers` (out of scope for read-only).

### 2B — Timing `notifySubscribers` (read-only)

The prompt suggests adding `performance.now()` logging. **Not done** (would be a code change). If the user adds it locally: watch for **>5ms** per call when many symbols have subscribers.

---

## Step 3 — Redis / ws-gateway (local samples)

### 3A — ws-gateway log (`/tmp/Gateway WS.log` on this machine)

Searched for queue/drop/saturation strings:

```bash
grep -iE "TrySendError|queue full|dropping|Full\(" "/tmp/Gateway WS.log"
```

**Result:** **no matches** in the sampled file (no evidence of tick drops via those strings in this slice).

Sample **DEBUG** tick lines present (gateway is dispatching ticks successfully to at least one connection):

```text
2026-05-22T17:10:40.996544Z DEBUG ws_gateway::stream::broadcaster: 📡 Broadcast tick ZECUSDT to 1 connections (0 failed)
```

**Caveat:** Log level / retention may omit `TrySendError::Full` for ticks (code path is intentionally quiet for ticks). Absence of lines is **not** proof the queue never fills under user load.

### 3B — Redis `PUBSUB` / clients (local `redis-cli`)

```text
redis-cli PUBSUB NUMSUB price:ticks
price:ticks
2

redis-cli INFO clients | head
connected_clients:9
pubsub_clients:4
...
```

**Interpretation:** **`price:ticks`** has **2** Redis pub/sub subscribers (typical: e.g. `ws-gateway` + another consumer). This does **not** measure browser WS rate.

### 3C — Tick rate from logs

No automated **messages/sec** computed (would need time-bounded log parsing). Manual: compare line density in `/tmp/Gateway WS.log` for `Broadcast tick` during busy market windows vs user perception in UI.

---

## Step 4 — Browser WebSocket frames (manual)

**User should record:**

1. Approximate **incoming WS messages/sec** (Network → WS → Messages).
2. **Sample payload size** (bytes) and JSON shape (`type: "tick"`, `symbol`, `bid`, `ask`, `ts`).
3. Any **reconnect** / close events.

**Interpretation guide:**

- **Low** msg/s vs many changing symbols → upstream throttling, subscription gaps, or filtering.
- **Very high** msg/s → browser/JS dispatch cost; pairs with Step 2/5.

---

## Step 5 — Performance / long tasks (manual)

Chrome **Performance** recording ~10s on the terminal:

- Largest **long task** duration.
- **Scripting** vs **Idle** ratio.
- Layout thrashing warnings if any.

**Read-only expectation:** With **~586 mounted `PriceCell`s`**, aggregate **`setState` per tick across symbols** can drive **scripting** time up even if list parents rarely commit (Phase 1 intent).

---

## Step 6 — Stocks vs crypto / MMDPS (code path)

**Feeds under** `backend/data-provider/src/feeds/`**:** `binance_feed`, `mmdps_feed`, `feed_router`, `routing`.

`FeedRouter` documents routing: Binance-style spot vs MMDPS; non-Binance symbols use MMDPS when configured:

```1:3:backend/data-provider/src/feeds/feed_router.rs
//! Routes each symbol to Binance or MMDPS.
//! With MMDPS auto-routing, Binance-style spot symbols use Binance; others use MMDPS.
```

**Tick rate (code, not live measurement):** `backend/data-provider` publish loop remains **100ms** with **dedup** on unchanged raw bid/ask (see `docs/symbol-list-performance-diagnostic.md` / `main.rs`). **Stock vs crypto rate** must be measured from **logs or Redis capture** (not done read-only here).

**User commands (optional):**

```bash
# Example: count symbol mentions in recent data-provider log (paths vary)
grep -c "AAPL" "/tmp/Data Provider.log"
grep -c "BTCUSDT" "/tmp/Data Provider.log"
```

Interpret only as **relative mention frequency**, not strict Hz without timestamps.

---

## Step 7 — Memory (manual)

User: Chrome Task Manager → tab memory now vs ~280-symbol era; watch **5–10 min** for drift (leak vs plateau).

**Code note:** `priceStore` is a **`Map` of latest quote per key** (not an unbounded tick history) in `usePriceStream.ts` — a leak is more likely from **duplicate subscriptions**, **retained closures**, or **profiler-unrelated** tabs than from append-only tick arrays in this path.

---

## Step 8 — End-to-end latency (manual)

Compare **`ts`** on WS tick vs wall-clock when the **cell** visibly updates. Large gap → browser/render path; tiny gap but sparse ticks → upstream symbol quiescence.

---

## Step 9 — Hypotheses ranked (evidence-linked)

| ID | Hypothesis | Evidence in this pass | Next-step fix (one line) | Effort |
|----|--------------|----------------------|---------------------------|--------|
| **A** | Phase 1 did not decouple in **runtime** (profiler) | **Not measured** — Step 1B required | Find parent still subscribing to tick-driven store or unstable `useShallow` input | hours–days |
| **B** | **Per-symbol subscriber + React work scales with symbol count** | **586× `PriceCell` → 586× `useSymbolPrice` callbacks**; each tick runs **`notifySubscribers`**; **double `onTick`** from `usePriceStreamConnection` + **`BottomDock` `usePriceStream`** | Remove duplicate `onTick` → `notifySubscribers` path (e.g. single hook / chart subscribe without duplicating global tick fan-in) + **virtualize** list (Phase 2) | days |
| **C** | ws-gateway **queue drop** / slow send | **No** `TrySendError`/`queue` grep hits in `/tmp/Gateway WS.log` sample | Raise cap / batch ticks / slow-client policy | days |
| **D** | **Main-thread** saturation | **Not measured** — Step 5 | `startTransition`, reduce work per tick, virtualize | days |
| **E** | **Memory / GC** | **Not measured** — Step 7 | Heap snapshot diff, audit subscriptions | days |
| **F** | **Stock feed** unusually hot | **Not measured** — Step 6 | Throttle / coalesce by asset class at provider | days–weeks |

---

## Primary conclusion (single paragraph)

**Phase 1 wiring is present in source** (`usePriceStreamConnection` in `AppShellTerminal`, `PriceCell`/`useShallow` in sidebars, `useSymbolPrice` in `RightTradingPanel`), but **this read-only pass did not run the React Profiler**, so we **cannot confirm** list parents are quiet at 586 symbols. Independently, the code shows **two global `priceStreamClient.onTick` registrations** on the terminal shell (`usePriceStreamConnection` + **`BottomDock`’s `usePriceStream`**), each calling **`notifySubscribers`**, which can **invoke the same symbol’s `useSymbolPrice` callbacks twice per inbound tick**; combined with **~586 mounted price cells** (no list virtualization yet), the **strongest code-backed hypothesis** for “downstream slowness” is **Hypothesis B** (subscriber / duplicate-dispatch / per-cell React cost), not Redis or ws-gateway queue errors in the sampled logs.

---

## Recommended next step (one line)

**Run React Profiler (Step 1B) and, if list parents are quiet, prototype removing the duplicate `onTick → notifySubscribers` path (`BottomDock` `usePriceStream` vs shell `usePriceStreamConnection`) and add list virtualization — measure before/after.**
