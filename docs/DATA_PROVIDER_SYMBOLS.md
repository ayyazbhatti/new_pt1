# Data provider: how many symbols & how to add more

## How many symbols the data provider sends

- **By default:** **5 symbols** are subscribed at startup and published to Redis `price:ticks` (and to the gateway):
  - `BTCUSDT`, `ETHUSDT`, `EURUSD`, `BNBUSDT`, `DOGEUSDT`
- **At runtime:** The data provider can have more symbols if:
  1. You set **`INITIAL_SYMBOLS`** (see below), or
  2. A client connects to the **data-provider WebSocket** (e.g. `ws://localhost:3001/ws` or the WS port from `HTTP_PORT`) and sends a `subscribe` message with extra symbols. Those are added to the feed and published. The terminal normally connects to the **gateway** (port 3003), not the data-provider WS, so by default only the initial list is used.

So the number of symbols “the data provider is sending” is: **initial list (5 or whatever you set) + any symbols added via the data-provider WS**. The gateway only forwards ticks that the data provider publishes; it does not add symbols.

---

## How to add more symbols (full steps)

### 1. Use the same symbols as your platform (DB)

The terminal gets the symbol list from the **API** (symbols table). For each symbol it derives a **feed code** (e.g. `provider_symbol` or `symbolCode`; for crypto USD it becomes `XXXUSDT`). So:

- For a symbol to **show in the terminal** and be **subscribable**: it must exist in the **symbols** table (admin: Symbols).
- For that symbol to **have live prices**: the data provider must be **publishing** that symbol (see step 2).

So when adding a new symbol you care about for prices:

1. **Add the symbol in Admin** (if not already): Symbols → create/ensure the symbol (e.g. code `SOLUSDT`, provider symbol `SOLUSDT`). Then the terminal will include it in the list and in the subscription request to the gateway.
2. **Make the data provider publish that symbol** (see below). Until the data provider publishes it, the gateway has no tick for it and the terminal will show no (or stale) price.

### 2. Make the data provider publish more symbols

You can do either **A** or **B**.

#### Option A: Environment variable (no code change)

Set **`INITIAL_SYMBOLS`** to a comma-separated list (case does not matter; stored uppercase):

```bash
export INITIAL_SYMBOLS="BTCUSDT,ETHUSDT,BNBUSDT,DOGEUSDT,SOLUSDT,XRPUSDT,ADAUSDT"
```

Then **restart the data provider**. It will subscribe to Binance for each of these and publish ticks to Redis (and the gateway will forward them).

- If you use `scripts/start-all-servers.sh`, set the env before running, or put `INITIAL_SYMBOLS=...` in `.env` in the repo root / `backend/data-provider` if that script sources it.
- Limit: the feed is **Binance** (spot). Only symbols that exist on Binance (e.g. `*USDT`) will get real data. Others (e.g. `EURUSD`) will not get updates from this feed.

#### Option B: Code change (default list)

Edit **`backend/data-provider/src/main.rs`** and change the default list used when `INITIAL_SYMBOLS` is not set:

```rust
_ => vec![
    "BTCUSDT".into(),
    "ETHUSDT".into(),
    "BNBUSDT".into(),
    "DOGEUSDT".into(),
    "SOLUSDT".into(),   // add more as needed
    "XRPUSDT".into(),
],
```

Then **rebuild and restart** the data provider.

### 3. Per-group markup (optional)

If you use **price stream profiles / markup**:

- Auth-service builds Redis markup keys from **all symbol codes** in the `symbols` table (`get_all_symbol_codes()`). So if the new symbol is in the DB, auth will write markup for it for each group that has a price profile. No extra step for markup beyond adding the symbol in Admin and ensuring the data provider publishes the same symbol (e.g. `SOLUSDT`).

---

## Summary checklist: add a new symbol with live prices

1. **Admin:** Add the symbol in Symbols (code / provider symbol, e.g. `SOLUSDT`) so the terminal shows it and subscribes with that code.
2. **Data provider:** Add it to the published set:
   - **Preferred:** set `INITIAL_SYMBOLS` (e.g. `...SOLUSDT,...`) and restart data provider, or
   - **Alternative:** add it to the default `vec![]` in `main.rs` and rebuild/restart.
3. **Restart** the data provider after changing env or code.
4. Use only **Binance spot** symbols (e.g. `*USDT`) if you want real prices from the current feed.

After that, the data provider will send ticks for the new symbol, the gateway will forward them, and the terminal will show live prices for it (and markup will apply if configured for that group).
