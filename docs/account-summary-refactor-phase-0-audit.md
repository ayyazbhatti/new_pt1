# Account summary refactor — **Phase 0: behavior audit** (read-only)

**Status:** Phase 0 complete — **no production code was modified** for this document.  
**Next:** Phases 1–5 require **explicit human approval** before any design or implementation work begins.

---

## Step 1 — Enumerate the existing code surface

Commands run (Phase 0, read-only):

```bash
grep -rn "compute_account_summary\|compute_and_cache_account_summary\|compute_account_summary_inner\|pos:summary\|account.summary.updated\|account:summary:updated\|wallet.balance.updated\|wallet:balance:updated" backend/ apps/ --include="*.rs"
grep -rn "useAccountSummary\|fetchAccountSummary\|account_summary\|accountSummary" src/ --include="*.ts" --include="*.tsx"
```

Below is **every match** from those greps, **grouped by file** (path:line — excerpt).

### 1A. Backend + apps — `*.rs`

**`backend/auth-service/src/routes/deposits.rs`**

| Line | Match context |
|------|----------------|
| 53 | Doc: NATS for stop-out so `compute_and_cache_account_summary_with_prices` can publish |
| 198 | Doc: `try_publish_stop_out_close_all` called from `compute_and_cache_account_summary_with_prices` |
| 1287 | Doc: caches to `pos:summary`, publishes `account:summary:updated` |
| 1290 | `pub async fn compute_and_cache_account_summary` |
| 1295 | delegates to `compute_and_cache_account_summary_with_prices(..., None)` |
| 1948 | Doc: tick-driven `_with_prices` |
| 1950 | `pub async fn compute_and_cache_account_summary_with_prices` |
| 1959 | `compute_account_summary_inner(...)` |
| 2010 | comment: `pos:summary` / `user:balance` not gated by publish throttle |
| 2029 | warn string: SET `user:balance` JSON for order-engine |
| 2038 | `PUBLISH` `account:summary:updated` |
| 2071 | `pub(crate) async fn compute_account_summary_inner` |
| 2237 | `PUBLISH` `wallet:balance:updated` (inside `publish_wallet_balance_updated`) |
| 2238 | log: Published wallet.balance.updated to Redis |
| 2240 | error: Failed to publish wallet.balance.updated |
| 2251 | Doc: NATS `wallet.balance.updated` for gateway-ws |
| 2273 | `VersionedMessage::new("wallet.balance.updated", ...)` |
| 2275 | `nats.publish("wallet.balance.updated", ...)` |
| 2276 | log: Published wallet.balance.updated to NATS |
| 2286 | Doc: `pos:summary` vs `pos:agg:unrealized_usd_e6` (merge behavior) |
| 2404 | `compute_account_summary_inner` (HTTP / admin miss path) |
| 2414 | `compute_and_cache_account_summary` |
| 2510 | `compute_account_summary_inner` |
| 2520 | `compute_and_cache_account_summary` |
| 2830 | `compute_and_cache_account_summary` (referrer) |
| 2896 | `compute_and_cache_account_summary` |
| 3031 | `compute_and_cache_account_summary` (referrer) |
| 3174 | `VersionedMessage::new("wallet.balance.updated", ...)` (deposit approve) |
| 3179 | `nats.publish("wallet.balance.updated", ...)` |
| 3184 | `compute_and_cache_account_summary` after approve |

**`backend/auth-service/src/routes/orders.rs`**

| Line | Match context |
|------|----------------|
| 21 | `use` imports `compute_and_cache_account_summary`, `get_free_margin_from_db_fast` |
| 746 | `compute_and_cache_account_summary` inside `tokio::spawn` (cache warm) |
| 887 | `compute_and_cache_account_summary` after commit |
| 964 | comment references `compute_and_cache_account_summary` |

**`backend/auth-service/src/routes/admin_trading.rs`**

| Line | Match context |
|------|----------------|
| 22 | `use` imports |
| 771 | `compute_and_cache_account_summary` |
| 861 | comment references `compute_and_cache_account_summary` |

**`backend/auth-service/src/routes/admin_bonus.rs`**

| Line | Match context |
|------|----------------|
| 18 | `use` `compute_and_cache_account_summary`, `publish_wallet_balance_updated` |
| 152 | `compute_and_cache_account_summary` |
| 218 | `compute_and_cache_account_summary` |

**`backend/auth-service/src/routes/finance.rs`**

| Line | Match context |
|------|----------------|
| 23 | `use` imports `compute_and_cache_account_summary`, `publish_wallet_balance_updated`, NATS publish helpers |
| 336 | `compute_and_cache_account_summary` |
| 337 | comment: NATS `wallet.balance.updated` for gateway-ws |
| 343 | `compute_and_cache_account_summary` (referrer id) |

**`backend/auth-service/src/lib.rs`**

| Line | Match context |
|------|----------------|
| 507 | `use` imports `compute_and_cache_account_summary`, `publish_wallet_balance_updated`, … |
| 595 | `compute_and_cache_account_summary` in `event.position.closed` handler |
| 601 | `publish_wallet_balance_updated` (same handler block) |
| 639 | `use routes::deposits::publish_wallet_balance_updated` |
| 660 | `publish_wallet_balance_updated` on `wallet:balance:request` |

**`backend/auth-service/src/services/swap_engine.rs`**

| Line | Match context |
|------|----------------|
| 10 | `use` `compute_and_cache_account_summary` |
| 295 | `compute_and_cache_account_summary` |

**`backend/auth-service/src/services/order_event_handler.rs`**

| Line | Match context |
|------|----------------|
| 4 | `use` `compute_and_cache_account_summary` |
| 83, 98, 118, 158, 173, 193 | `compute_and_cache_account_summary` |

**`backend/auth-service/src/services/position_event_handler.rs`**

| Line | Match context |
|------|----------------|
| 3 | `use` `compute_and_cache_account_summary` |
| 60, 77 | `compute_and_cache_account_summary` |

**`backend/auth-service/src/services/price_tick_summary_handler.rs`**

| Line | Match context |
|------|----------------|
| 4 | `use` `compute_and_cache_account_summary_with_prices` |
| 185 | `compute_and_cache_account_summary_with_prices` |

**`backend/auth-service/src/services/account_summary_cache_warmup.rs`**

| Line | Match context |
|------|----------------|
| 1 | module doc mentions `pos:summary:{user_id}` |
| 4 | `use` `compute_and_cache_account_summary` |
| 38 | `compute_and_cache_account_summary` |

**`backend/ws-gateway/src/main.rs`**

| Line | Match context |
|------|----------------|
| 97 | subscribe list: `"wallet:balance:updated"` |
| 98 | subscribe list: `"account:summary:updated"` |

**`backend/ws-gateway/src/stream/broadcaster.rs`**

| Line | Match context |
|------|----------------|
| 143 | match `"wallet:balance:updated"` |
| 146 | match `"account:summary:updated"` |
| 610 | log: Broadcasting `wallet.balance.updated` |
| 623 | log: Sending `wallet.balance.updated` |

**`backend/ws-gateway/src/ws/protocol.rs`**

| Line | Match context |
|------|----------------|
| 117 | serde rename `wallet.balance.updated` |
| 121 | serde rename `account.summary.updated` |

**`apps/gateway-ws/src/main.rs`**

| Line | Match context |
|------|----------------|
| 103 | log: Redis `account:summary:updated` forwarder |
| 316–322 | NATS subscribe `wallet.balance.updated` + logs |
| 506–560 | `wallet.balance.updated` branch (parse, forward, skip cases) |
| 717–731 | Redis subscribe `account:summary:updated` |
| 760 | outbound `"type": "account.summary.updated"` |

**`apps/gateway-ws/src/auth.rs`**

| Line | Match context |
|------|----------------|
| 3 | doc comment mentions NATS `wallet.balance.updated` |

**`apps/core-api/src/deposits.rs`**

| Line | Match context |
|------|----------------|
| 559 | comment: Publish `wallet.balance.updated` |
| 571 | `VersionedMessage::new("wallet.balance.updated", ...)` |
| 576 | `nats.publish("wallet.balance.updated", ...)` |

### 1B. Frontend — `src/**/*.ts` / `*.tsx`

**`src/features/wallet/api.ts`** — line 49: `fetchAccountSummary`.

**`src/features/wallet/hooks/useAccountSummary.ts`** — lines 6, 8, 20, 94, 98, 100, 119, 121, 124: `fetchAccountSummary`, `QUERY_KEY` / `accountSummaryQueryKey`, `useAccountSummary`, `accountSummary` state.

**`src/features/wallet/hooks/useMarginCall.ts`** — lines 12, 17–19, 38, 49, 57: `accountSummary` parameter and fields.

**`src/features/wallet/components/MarginCallModal.tsx`** — lines 10, 19, 52, 57, 63, 69: `accountSummary` prop / display.

**`src/features/terminal/pages/AppShellTerminal.tsx`** — lines 22, 99, 109, 275: `useAccountSummary`, `accountSummary`, `useMarginCall`, modal prop.

**`src/features/terminal/components/LeftSidebar.tsx`** — lines 18, 84, 134–135, 141, 397–404: `useAccountSummary`, `accountSummaryQueryKey`, `accountSummary` display fallbacks.

**`src/features/terminal/components/BottomDock.tsx`** — lines 17–19, 188, 526, 854–858, 1561–1589: `useAccountSummary`, WS `account.summary.updated` handler, `accountSummary` UI.

**`src/features/terminal/components/RightTradingPanel.tsx`** — lines 40, 235, 815, 1256: `useAccountSummary`, `accountSummary?.freeMargin`.

**`src/features/terminal/components/TerminalPositionsView.tsx`** — lines 5, 18, 22: `useAccountSummary`, `unrealizedPnl`.

**`src/features/terminal/components/TerminalHistoryView.tsx`** — lines 8, 48, 129–161: `useAccountSummary`, snapshot labels.

**`src/features/terminal/components/TerminalAccountView.tsx`** — lines 10, 34, 40–45: `useAccountSummary`, display fallbacks.

**`src/features/terminal/components/ChartTradingStrip.tsx`** — lines 7, 24, 58: `useAccountSummary`, `freeMargin`.

**`src/features/userPanel/pages/UserDashboardPage.tsx`** — lines 5, 78, 106–130: `useAccountSummary`, balance/bonus/equity/margin display.

**`src/features/userPanel/pages/UserWithdrawPage.tsx`** — lines 7, 47, 50–51: `useAccountSummary`, `accountSummary?.balance`.

**`src/features/adminUsers/modals/UserDetailsModal.tsx`** — lines 521–575, 589, 663–691, 672–758, 774, 993, 1688: `accountSummary` / `accountSummaryQueryKey` / admin query + effects.

**`apps/order-engine`** (supplementary grep for balance key — not in the user’s Step 1 pattern but part of the read surface):

- `apps/order-engine/src/engine/validation.rs:82` — `user:{}:balance`
- `apps/order-engine/src/engine/position_handler.rs:271` — `user:{}:balance`

**`backend/auth-service/src/routes/ai_chat.rs`** (not matched by the Step 1 shell pattern; found by `get_account_summary_for_user` search): `20` import `get_account_summary_for_user`; `268` await; `327` JSON key `"accountSummary"`.

**Related docs (not grep hits but scope):** `docs/balance-writer-audit.md`, `docs/handler-proliferation-and-timing-diagnostic.md`, `docs/account-summary-math-audit.md`, `docs/leftsidebar-account-summary-source-unification-fix.md`.

---

## Step 2 — Inputs (`compute_account_summary_inner` and related)

Primary function: `pub(crate) async fn compute_account_summary_inner` — `backend/auth-service/src/routes/deposits.rs:2071–2207`.

| Input | Source | Used for | Edge cases |
|-------|--------|----------|------------|
| `user_id: Uuid` | Caller | All queries / Redis keys | — |
| `redis: Option<&RedisPool>` | Caller | Required path uses `Some` | `None` → error `"Redis is required..."` (~2085–2088) |
| `price_overrides: Option<&PriceOverrides>` | `compute_and_cache_account_summary_with_prices` only | `(symbol, group_id) → (bid, ask)` for unrealized in `fetch_position_aggregates_from_redis` | `None` → `get_price_from_redis` per position (`deposits.rs:969–1000`); if still missing, fall back to stored `unrealized_pnl` on hash (`915–937`, `994–999`) |
| **margin_calculation_type** | Postgres `users.margin_calculation_type`, default `'hedged'` | `fetch_position_aggregates_from_redis` / `_from_db` branching | `COALESCE(..., 'hedged')` ~2077–2083 |
| **FX snapshot** | `fx_rates::get_cached_snapshot(redis_pool)` | All USD conversions for positions | `None` → `FxRatesUnavailable` (~2091–2094); unsupported quote → rows skipped inside fetch / sum_closed |
| **Position aggregates** `(margin_used, unrealized, _)`** | **Prefer** `fetch_position_aggregates_from_redis` (~2099–2107) | Margin + unrealized in USD | Returns `None` → **DB fallback** `fetch_position_aggregates_from_db` (~2110–2121) with log |
| **realized_pnl (summary field)** | `sum_closed_realized_pnl_usd` (~2125) | Closed positions **Postgres** `positions` joined `symbols`; `pnl + bonus_loss_absorbed` converted to USD | Rows skipped if quote unsupported or FX fails (~155–196) |
| **bonus_balance** | `wallets.bonus_balance` USD spot | Equity | Missing wallet row → `Decimal::ZERO` (~2127–2133) |
| **available_balance, locked_balance** | `wallets` USD spot | `balance = available + locked` (~2135–2147) | Missing row → `(0,0)` |
| **total_swap_paid_usd** | `SUM(-amount)` completed `swap` **transactions** USD | Summary display field | — |
| **total_fees_paid_usd** | `SUM(-amount)` completed `fee` **transactions** USD | Summary display field | — |

**Separate path — `calculate_wallet_balance` (`deposits.rs:543–613`)** (used by `publish_wallet_balance_updated`, **not** identical inputs to summary):

| Input | Source | Notes |
|-------|--------|-------|
| Wallet cash + bonus | Same `wallets` row | Same as summary cash legs |
| Unrealized | `SUM(pnl)` Postgres **open** positions | **Differs** from summary: summary uses **Redis** (or DB via `fetch_position_aggregates_from_db` with FX + hedged/net rules) |
| Margin | `SUM(margin_used)` Postgres open | **Differs** from Redis/netting path |

**Separate path — `get_free_margin_from_db_fast` (`deposits.rs:1182–1285`):**

- Builds `balance` as **deposits − withdrawals + closed realized (USD)** (~1191–1229), **not** `available+locked` from wallet.
- Then `+ bonus`, open-position margin/unrealized via `fetch_position_aggregates_from_db` with fallback `SUM` open rows (~1251–1276).
- **Implication:** Three different “balance / free margin” constructions exist (wallet row, ledger-style fast path, summary inner). A centralized module must decide which is **authoritative** for which consumer.

**In-memory / coordination:**

| Mechanism | Location | Behavior |
|-----------|----------|----------|
| `AccountSummaryCoordinator` | `deposits.rs:296–337`, `COORDINATOR` ~340–345 | Per-user `Mutex` serializes compute (`run_exclusive` ~2064–2067); **`should_publish` / `record_publish`** throttle **Redis `PUBLISH account:summary:updated`** to **250ms** per user (~303, ~327–337, ~2033–2042) |
| `init_account_summary_coordinator` | ~343–345 | Called from app startup |

**Redis keys read inside compute path (non-exhaustive; see `fetch_position_aggregates_from_redis` ~773+):**

- `pos:{user_id}` — SMEMBERS position ids ~789
- `pos:by_id:{id}` — per-field HGETs for symbol, status, margin, size, side, prices, etc.
- `prices:{symbol}:{group_id}` via `get_price_from_redis` when recomputing unrealized without override
- `fx:rates:usd` (via `fx_rates::get_cached_snapshot`)
- `group:{group_id}` for thresholds (via `get_margin_call_level_for_group` / `get_stop_out_level_for_group` ~1962–1966, also HTTP path ~2356–2367)
- **After HTTP read path:** `key_user_unrealized_agg_e6` (see `merge_live_unrealized_from_redis_agg`, `deposits.rs:2298–2301`) — doc at `2286–2289` names this as tick aggregate vs `pos:summary`; **not** part of inner compute; **HTTP response overlay** only
- **Open swap accrual:** `sum_open_accumulated_swap_usd` then `unrealized_pnl -= swap_open` (`1048–1051`); cache key `swap_open_usd_e6` SET (`1054–1057`); Lua `aggregate_user_unrealized_usd_e6_in_redis` updates user aggregate (`1058–1063`)

---

## Step 3 — Outputs

### 3A. `AccountSummary` struct (`deposits.rs:619–644`, built ~2192–2206)

| Field | Meaning (plain English) |
|-------|-------------------------|
| `user_id` | User UUID string |
| `balance` | **Cash ledger view:** `available_balance + locked_balance` (USD spot wallet), **not** bonus |
| `equity` | `balance + bonus_balance + unrealized_pnl` (~2177) |
| `margin_used` | Aggregated open-position margin (USD), hedged vs net per user setting |
| `free_margin` | `max(0, equity − margin_used)` (~2178–2182) |
| `margin_level` | `(equity / margin_used) * 100` formatted, or **`"inf"`** if `margin_used == 0` (~2184–2188) |
| `margin_call_level_threshold` / `stop_out_level_threshold` | Filled after inner compute from group Redis/DB (~1970–1973); `None` in inner return |
| `realized_pnl` | **Closed** positions realized (USD) via `sum_closed_realized_pnl_usd` |
| `unrealized_pnl` | Open positions (USD) from aggregate path |
| `bonus` | `bonus_balance` from wallet |
| `total_swap_paid_usd` / `total_fees_paid_usd` | Lifetime completed swap/fee debits |
| `updated_at` | RFC3339 now |

### 3B. Postgres writes from summary compute

**None** inside `compute_account_summary_inner` / `compute_and_cache_account_summary_with_prices` — read-only relative to OLTP tables.

### 3C. Redis writes (`compute_and_cache_account_summary_with_prices`, ~1983–2030)

- **Hash** `Keys::account_summary(user_id)` → `pos:summary:{uuid}`: fields `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, thresholds, `liquidation_level` fixed `"0"`, `realized_pnl`, `unrealized_pnl`, `bonus`, `total_swap_paid_usd`, `total_fees_paid_usd`, `updated_at` (~1992–2006).
- **String** `user:{user_id}:balance` — JSON with `currency`, `available` (= **free_margin** string, **not** wallet spot `available_balance`), `locked` `"0"`, `equity`, `margin_used`, `free_margin`, `updated_at` ms (`2011–2024`). **Always written** when hash write succeeds; **not** gated by publish throttle (`2009–2010` comment).

### 3D. Redis pub/sub

| Channel | Payload | Gated? |
|---------|---------|--------|
| `account:summary:updated` | Full serialized `AccountSummary` JSON (camelCase via serde) | **Yes** — `COORDINATOR.should_publish` (~2033–2046); 250ms |
| `wallet:balance:updated` | JSON from `publish_wallet_balance_updated` (~2220–2234) | Separate code paths (not the same throttle as account summary publish) |

### 3E. NATS

- `publish_wallet_balance_updated_nats` — `wallet.balance.updated` (~2273–2276).
- Deposit approval path publishes `wallet.balance.updated` (~3174–3179 in grep region — see `deposits.rs` NATS publish block).
- `try_publish_stop_out_close_all` / `try_publish_liquidation_close_all` — `cmd.position.close_all` (~232–244, ~266+).

### 3F. Return value

- `compute_account_summary_inner` → `Result<AccountSummary, anyhow::Error>`.
- `compute_and_cache_account_summary_with_prices` → `()`; errors logged inside closure (~2058–2060).

---

## Step 4 — Business rules (IF/ELSE and special cases)

Rules below cite **`deposits.rs`** unless noted.

| Rule | Plain English | Code anchor |
|------|---------------|-------------|
| **Equity** | Cash wallet (avail+lock) + bonus + unrealized | ~2177 |
| **Free margin** | Equity minus margin if equity ≥ margin, else 0 | ~2178–2182 |
| **Margin level ∞** | If no margin in use, level is `"inf"` string | ~2184–2188 |
| **Hedged vs net margin (Redis)** | **`net`:** accumulate `(symbol, group_id)` groups with abs size, signed size, margin in quote (`874–893`); after loop, `net_ratio = |net_signed|/total_abs` capped at 1, margin USD from `net_ratio * total_margin` (`1030–1045`). **`hedged`:** per open position convert `margin` field to USD and sum (`894–907`). | `774–1045` |
| **Unrealized PnL (Redis, open)** | LONG: `(bid - avg_price)*size`; SHORT: `(avg_price - ask)*size`; unknown side → stored `unrealized_pnl` on hash; with `price_overrides`, same logic but bid/ask from override or Redis (`909–1001`); convert quote → USD (`1003–1022`); on FX failure for unrealized, **hedged** rolls back margin increment (`1012–1018`) | `956–1022` |
| **Open swap deducted from unrealized** | After per-position loop, subtract `sum_open_accumulated_swap_usd` from aggregate unrealized | `1048–1051` |
| **Hedged vs net (DB fallback)** | `fetch_position_aggregates_from_db` mirrors net grouping by `symbol_id` (`1108–1144`+) vs hedged per-row margin (`1099+` region continues in file) | `1069–1144` (start of net branch) |
| **Redis vs DB positions** | If Redis SMEMBERS / aggregate fails → DB aggregates | ~2107–2121 |
| **FX** | Positions realized/unrealized converted to USD using shared snapshot; unsupported quotes skipped with warn | `sum_closed` ~182–193; fetch loops warn similarly |
| **Closed realized includes bonus absorption** | `pnl + COALESCE(bonus_loss_absorbed,0)` per closed row | ~180 |
| **Stop-out** | If parsed `margin_level` **&lt;** `stop_out_threshold` (and threshold `Some`), Redis SET NX cooldown 60s, NATS `cmd.position.close_all` | ~198–244 |
| **Liquidation** | If parsed `margin_level` **&lt; 0**, similar cooldown + publish with liquidated reason | ~247–290 (see ~247+) |
| **Tick handler per-user throttle** | Skip summary recompute if same user within **100ms** | `price_tick_summary_handler.rs:32–44`, ~181–183 |
| **Publish throttle** | Skip `account:summary:updated` if last publish &lt; **250ms** | `deposits.rs:303`, ~2033–2042 |
| **HTTP cache read overlay** | After reading `pos:summary`, if tick aggregate key exists, **replace** `unrealized_pnl` and recompute `equity`, `free_margin`, `margin_level` from `balance`, `bonus`, `margin_used` (`2307–2318`) | `merge_live_unrealized_from_redis_agg` `2290–2318`; call sites `2399`, `2420`, `2506`, `2526` |
| **`calculate_wallet_balance` vs summary** | Wallet event uses **Postgres** open `pnl`/`margin_used`, not Redis netting | ~567–592 vs inner ~2097–2123 |

**Affiliate / commission:** Not inside `compute_account_summary_inner`; referrer recompute at `deposits.rs:2830`, `:3031` (and related deposit flow lines in same file — see Step 1 table).

**Tests:** Repo has finance/summary tests in various crates; Phase 0 did not exhaustively grep `#[test]` for `compute_account`. Known narrative audit: `docs/account-summary-math-audit.md`.

---

## Step 5 — Callers (recompute / cache triggers)

| Caller file:line | Trigger | Await? | Notes |
|------------------|---------|--------|-------|
| `orders.rs:887` | After successful `place_order` **commit** | **Sync `.await`** | Also background warm ~745–747 **spawn** on cold `free_margin` cache |
| `orders.rs:746` | Background cache warm | `tokio::spawn` | Fire-and-forget |
| `admin_trading.rs:771` | Admin order / trading mutation tail | `.await` | See balance-writer-audit |
| `finance.rs:336`, `:343` | Approve transaction; referrer | `.await` | May publish wallet NATS nearby |
| `admin_bonus.rs:152`, `:218` | Grant / revoke bonus | `.await` | |
| `position_event_handler.rs:60`, `:77` | Position NATS sync done | `.await` | |
| `order_event_handler.rs` (6 sites) | Order lifecycle events | `.await` | Lines ~83–193 |
| `swap_engine.rs:295` | Swap charge applied | `.await` | |
| `deposits.rs:2830`, `:2896`, `:3031`, `:3184` | Referrer + user paths on deposit flows; tail after approve | `.await` | Exact lines from Step 1 grep; see `balance-writer-audit.md` for narrative |
| `lib.rs:595–606` | **`event.position.closed`** after wallet tx + optional swap settle | `.await` compute then **`publish_wallet_balance_updated`** | Order: **compute first**, then wallet publish — both awaited in loop |
| `lib.rs:660` | Redis `wallet:balance:request` | `.await` publish only | |
| `price_tick_summary_handler.rs:185–191` | Each **non-throttled** tick per user | `.await` | Uses `_with_prices` |
| `account_summary_cache_warmup.rs:38` | Service startup | `.await` per user | |
| `ai_chat.rs:268` | AI route builds context | `get_account_summary_for_user` — may compute on miss | Reads summary; not necessarily a write |

**Expectations:** Most callers rely on **side effects** (Redis hash + optional pub/sub + `user:balance` SET). Few consume the `AccountSummary` return value directly except HTTP/admin paths.

---

## Step 6 — Consumers (reads)

| Consumer | Reads from | Use |
|----------|------------|-----|
| **GET `/api/account/summary`** | `deposits.rs` `get_account_summary` — Redis HGET `pos:summary` or compute miss path + **`merge_live_unrealized`** | JSON to browser |
| **`get_account_summary_for_user`** | Same pattern for admin / AI | `ai_chat.rs:268` |
| **order-engine `validation.rs`** | `user:{id}:balance` GET | Pre-trade checks `82–86` |
| **order-engine `position_handler.rs`** | `user:{}:balance` `271` | Balance / event flow |
| **`orders.rs` `place_order`** | `HGET` `Keys::account_summary` field `free_margin` (`722–727`) | Margin gate before commit; on miss uses `get_free_margin_from_db_fast` (`739–740`) + background recompute (`745–747`) |
| **ws-gateway** | Redis `wallet:balance:updated`, `account:summary:updated` | WebSocket to browser |
| **gateway-ws** | NATS wallet + Redis account summary | Alternate deployment |
| **`useAccountSummary` + `fetchAccountSummary`** | HTTP + WS `account.summary.updated` | React Query `['accountSummary']` |
| **BottomDock positions WS** | `account.summary.updated` → `applyAccountSummaryWsToQueryCache` | `BottomDock.tsx:526–530`; shared guard in `useAccountSummary.ts:10–23`, `:113` |
| **LeftSidebar** | `useAccountSummary` + **`walletStore`** | `LeftSidebar.tsx:84`, `:397–404` (summary vs store fallbacks) |
| **`useGlobalWalletBalance`** | WS `wallet.balance.updated` | `useGlobalWalletBalance.ts:20` → `walletStore` |
| **UserDetailsModal (admin)** | Admin query + WS + **`invalidateQueries`** | Heavy refetch pattern |
| **Margin call hook** | Summary thresholds | Modal / warnings |

**core-api** `bal:{user}:USD` hash — **parallel** balance surface per `balance-writer-audit.md`; not `pos:summary` but affects some deployments.

---

## Step 7 — Problems the refactor should solve (with evidence)

| # | Problem | Current cause (file:line) | “Fixed” (measurable) |
|---|---------|---------------------------|------------------------|
| 1 | **Dual-source UI desync** | `wallet.balance.updated` → `publish_wallet_balance_updated` uses **`calculate_wallet_balance`** (Postgres PnL, `deposits.rs:567–592`) while **`pos:summary`** uses **Redis-first** aggregates (`2071–2123`); events on different channels/timing (`2237` vs `2038`) | Single writer + single event **or** documented single read model; UI sees one version of truth |
| 2 | **Scattered writers / readers** | Many `compute_and_cache_account_summary` call sites (Step 1); wallet SQL in multiple services (`balance-writer-audit.md`) | One module owns “account state snapshot”; call sites become thin |
| 3 | **Two WS events** | `wallet:balance:updated` vs `account:summary:updated` (`ws-gateway/main.rs:97–98`) | Option: unified payload or single channel with version |
| 4 | **Variable perceived timing** | Publish throttle 250ms (`303`); tick throttle 100ms (`price_tick_summary_handler.rs:15–16`); handler duplication on frontend (`handler-proliferation-and-timing-diagnostic.md`) | Predictable latency SLA or merged updates |

---

## Step 8 — Risks of refactor (and later-phase mitigations)

| Risk | Mitigation (Phase 3–5) |
|------|-------------------------|
| Numeric drift old vs new | **Shadow compare** keys / diff logs before cutover |
| Missed caller still on old API | **Exhaustive checklist** from Step 1 + grep CI gate |
| `user:balance` JSON out of sync with order-engine | Contract tests: order-engine reads same fields as today |
| `calculate_wallet_balance` / `get_free_margin_from_db_fast` subtle formula differences vs summary | Golden tests per user fixture; document which formula is canonical for **margin gate** vs **display** |
| FX / Redis unavailable behavior | Parity tests for `FxRatesUnavailable` paths |
| Throttle behavior change floods UI | Keep or intentionally adjust `PUBLISH_THROTTLE_MS` with product sign-off |

---

## Step 9 — Approval gate

- **This document (Phase 0)** is the sole artifact for Step 9.  
- **Human review is required** before **Phase 1 (design doc)** or any code.  
- Cursor / agents must **not** start Phase 1 without an explicit user message approving continuation.

---

## “What could surprise us” (audit gaps / edge cases)

1. **`calculate_wallet_balance` vs `compute_account_summary_inner`** — different unrealized/margin sources (Postgres vs Redis). Any “unify” that only touches summary **without** wallet publish will still leave **wallet WS** payload diverging from **summary** unless both use one pipeline (`543–613` vs `2071–2123`).
2. **`get_free_margin_from_db_fast`** uses **ledger-style balance**, not `wallets.available+locked` — cold-cache order path could theoretically disagree with summary if wallet and ledger diverge (`1182–1229`).
3. **`merge_live_unrealized_from_redis_agg`** only on **HTTP** read path — WebSocket clients can still see pre-merge numbers until next publish (documented in `redis-user-data-inventory.md`).
4. **order-engine** tick path updates `pos:agg:unrealized_usd_e6` (`apps/order-engine/.../position_tick_unrealized.rs` — not re-grepped here but exists); full parity requires reading that Lua + auth `fetch_position_aggregates` clearing behavior (~797–803 in deposits) together.
5. **Admin / impersonation** paths and **core-api** `bal:` hash may bypass assumptions in trader-only audits.
6. **NATS vs Redis** duplicate forwarding (`gateway-ws` vs `ws-gateway`) — operational complexity not fully expanded in this Phase 0 doc.

---

## Appendix A — `AccountSummaryCoordinator` (exact throttle constants)

- `PUBLISH_THROTTLE_MS = 250` — `deposits.rs:303`, used by `should_publish` ~327–332, `record_publish` ~335–337.

## Appendix B — `event.position.closed` ordering

- `lib.rs:595–606`: **`compute_and_cache_account_summary`** then **`publish_wallet_balance_updated`**. Any refactor must preserve or intentionally document ordering for downstream consumers.

---

*End of Phase 0 audit. Awaiting human approval before Phase 1.*
