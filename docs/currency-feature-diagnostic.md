# Currency display feature — read-only diagnostic

**Scope:** Map where monetary values (USD and symbol-native amounts) appear, how non-USD **symbol quote** currencies are handled today, backend payloads, schema, and infrastructure. **No code was modified** for this document.

**Folders scanned:** `src/`, `backend/auth-service/`, `backend/ws-gateway/`, `apps/order-engine/`, `apps/core-api/`, `crates/` (notably `contracts`, `risk`), `infra/migrations/`, `database/` (schema + migrations).

---

# 1. CURRENT MONETARY DISPLAY CONVENTIONS

## Central formatter

- **`src/shared/utils/currency.ts`** (lines 1–15): `formatCurrency(value, currency = 'USD')` uses `Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })`. Special case: `BTC` / `USDT` → fixed 8 decimals + suffix (no `Intl` style).

## All `formatCurrency` implementations found (verify: 4 distinct definitions)

| Location | Behavior |
|----------|----------|
| `src/shared/utils/currency.ts:5` | **Canonical** — parameterized `currency`, default USD |
| `src/features/leverageProfiles/utils/format.ts:2` | Local export — **USD-only**, 0 fraction digits |
| `src/features/adminTrading/pages/AdminTradingPage.tsx:314` | Inline `const formatCurrency = (n: number) => …` (file-local) |
| `src/features/admin/transactions/pages/AdminTransactionsPage.tsx:63` | Inline `const formatCurrency = (n: number) => …` (file-local) |

Many features **import** the shared helper (e.g. admin finance modals/panels, dashboard charts, admin users, managers, bulk deposits) via `@/shared/utils/currency` or `@/shared/utils` barrel — those are **call sites**, not duplicate definitions.

## Patterns in use (with 2–3 examples each)

1. **Hardcoded `$` in template literals** — e.g. `` `$${x.toFixed(2)}` ``
   - `src/features/terminal/components/BottomDock.tsx:818`–`822`, `1627`–`1634`
   - `src/features/userPanel/pages/UserDashboardPage.tsx:75`–`77` (`fmtUsd`)
   - `src/features/terminal/components/LeftSidebar.tsx:418`–`445`

2. **`toLocaleString('en-US', { style: 'currency', currency: 'USD' })`** — often embedded in components
   - `src/features/terminal/components/BottomDock.tsx:490` (toast)
   - `src/features/terminal/components/LeftSidebar.tsx:232`–`233` (toast)
   - UNC: many admin tables use `formatCurrency` which wraps `Intl` equivalently in `currency.ts`

3. **`Intl.NumberFormat` direct** (not always via shared helper)
   - `src/features/userPanel/pages/UserAffiliatePage.tsx:174`–`179`, `553`–`557`
   - `src/features/leverageProfiles/utils/format.ts:3`–`7`

4. **Plain `.toFixed(n)` with optional `$` prefix** (prices / PnL / sizes mixed)
   - `src/features/terminal/components/BottomDock.tsx:971`–`1244` (position/order rows)
   - `src/features/terminal/components/TerminalHistoryView.tsx:323`–`332`, `383`
   - `src/features/terminal/components/RightTradingPanel.tsx:94`–`143` (quote formatting helpers)

## `package.json` currency-related libraries

**File:** `package.json` (dependencies block, lines 13–43).

**Result:** No `currency.js`, `dinero.js`, `numeral.js`, or `accounting` (string search over `package.json` — none present). Formatting relies on **`Intl`**, **manual `$`**, and **`toFixed`**.

---

# 2. TERMINAL — MONETARY DISPLAY SURFACE

**Grep basis:** `src/features/terminal/**/*.tsx` for `` `$ `` / `toFixed` / `formatCurrency` / `toLocaleString` (then manual review to exclude non-money `$` — see §1 note on idempotency keys).

| File | Line(s) | What it shows | Source field | Current formatter | Convert set vs stay USD |
|------|---------|----------------|--------------|-------------------|-------------------------|
| `BottomDock.tsx` | 818–822 | Account strip: Balance, Equity, Margin, Free Margin | `accountSummary.*` | `` `$${…toFixed(2)}` `` | **Convert** (account-level) |
| `BottomDock.tsx` | 822 | Margin Level % | `accountSummary.marginLevel` | `%` or `∞` | **N/A** (percentage) |
| `BottomDock.tsx` | 490–491 | Toast: deposit / balance update | WS payload `balance` | `$` + `toLocaleString` USD | **Convert** |
| `BottomDock.tsx` | 971–996 | Mobile position card: size, entry→current, unrealized, margin, S/L T/P | `pos.*`, `livePrice` | `toFixed`; some cells prefixed `$` for margin/SL/TP | **Mixed:** mark-to-market prices = **symbol quote** (stay); margin / unrealized if treated as account USD → **Convert** — **UNCERTAIN:** backend may store PnL in quote units for non-USD symbols (see §5) |
| `BottomDock.tsx` | 1227–1244 | Desktop positions: Margin, Entry, Current, P&L, SL, TP | `pos.margin`, `entryPrice`, `livePrice`, `unrealizedPnl` | `$` + `toFixed` | **Mixed:** bid/ask/entry/current = **Stay** (raw symbol); margin/PnL labels use `$` but values may be quote-native — **red flag** alignment with §5 |
| `BottomDock.tsx` | 1499–1500 | Open orders: size, avg price | `order.*` | `avgPrice` with `$` | **Stay** (execution price in symbol terms) |
| `BottomDock.tsx` | 1581–1600 | Position history: entry, exit, realized PnL | history `pos` | `$` on prices; PnL with `$` | Realized PnL: **Convert** if canonical USD in ledger; prices **Stay** |
| `BottomDock.tsx` | 1627–1634 | Account metrics panel: Balance, Equity, Margin, Free Margin, Bonus, RI PNL, UnR Net PNL | `accountSummary.*` | `` `$${…toFixed(2)}` `` | **Convert** |
| `BottomDock.tsx` | 1983–2099 | Modal labels “Price ($)”, “Amount ($)” for SL/TP edit | form state | literal `$` in label | **Misleading** for non-USD quotes — should be **Stay** / relabeled to “quote” not “USD” |
| `RightTradingPanel.tsx` | 110–127 | LIVE QUOTE BID/ASK (and string fallbacks `bidQuote`/`askQuote`) | `MockSymbol` / tick-driven prices | `` `$${…}` `` | **Stay** (symbol quote stream) |
| `RightTradingPanel.tsx` | 130–143 | Spread display | bid/ask | `toFixed` | **Stay** (derived from quote) |
| `RightTradingPanel.tsx` | 610–709 | Cost breakdown: est. margin (USD naming in code), spread, fees | `serverMarginEstimate`, client fallback | `toFixed(2)` / `—` | Est. margin tied to **account free margin in USD ledger** → **Convert** for display; spread/fees **UNCERTAIN** (likely quote-relative or USD — verify product spec) |
| `RightTradingPanel.tsx` | 705+ | Display string for estimated margin dollars | computed | `toFixed` | **Convert** (account margin) |
| `ChartTradingStrip.tsx` | 81–84, 117, 157 | Est. margin display / validation toasts | estimate API + wallet | `` `$${…}` `` | **Convert** (margin vs account) |
| `TerminalHistoryView.tsx` | 117–141 | Snapshot cards: Balance, Realized, Equity, Free Margin (×2 layouts) | `accountSummary` | `` `$${…}` `` | **Convert** |
| `TerminalHistoryView.tsx` | 323–332 | Closed position row: size, entry→exit, realized PnL | position history | `toFixed`; PnL without currency code | **Mixed** (prices **Stay**; PnL **Convert** if USD) |
| `TerminalHistoryView.tsx` | 380–383 | Order history: size, type @ avg price | `order` | `$` on avg | **Stay** (fill price) |
| `LeftSidebar.tsx` | 232–233 | Toast balance update | WS | `$` + `toLocaleString` | **Convert** |
| `LeftSidebar.tsx` | 418–445 | Balance card, P/L vs balance, equity, margin | `useWalletStore` + `accountSummary` | `$` + `toLocaleString` | **Convert** |
| `TerminalAccountView.tsx` | 77–97 | Balance / equity / margin (account view) | same as sidebar | `$` + `toLocaleString` | **Convert** |
| `TerminalPositionsView.tsx` | 21 | Unrealized PnL string | `unrealizedPnl` | `` `+$${…}` `` | **Convert** if value is USD-equity; **Stay** if quote-native — **UNCERTAIN** (§5) |
| `PaymentPanel.tsx` | 134 | Deposit history row amount | `item.amount` | `$` + `toLocaleString` | **Convert** |
| `AppShellTerminal.tsx` | (grep hit) | UNC: verify line — likely string with `$` in toast or title | — | — | Review file |
| `TerminalMobileMenuPage.tsx` | (grep hit) | UNC: mobile shell money | — | — | Review file |

**`NotificationsPanel.tsx`:** No `$` / amount grep hits — notification **bodies** that include `$` are often composed **on the server** (see §6 `deposits.rs:2739`).

---

# 3. USER PANEL — MONETARY DISPLAY SURFACE

**Note:** `src/pages/user/**` does **not** exist in this repo; user routes live under `src/features/userPanel/**` (and router config elsewhere).

| File | Line(s) | What it shows | Source field | Current formatter | Convert vs stay |
|------|---------|----------------|--------------|-------------------|-----------------|
| `UserDashboardPage.tsx` | 75–77, 103–125 | Stat cards: Cash balance, Bonus, Equity, Margin used | `useAccountSummary()` | `fmtUsd` → `` `$${n.toFixed(2)}` `` | **Convert** |
| `UserDepositPage.tsx` | 124–126, 214–215, 231–255, 331 | Min/max hints, balance line, input adornment `$`, history amounts | `balance`, `method.min/max`, deposit rows | `$` literals + `toLocaleString` | **Convert** (amounts are ledger USD today) |
| `UserWithdrawPage.tsx` | 52–106 | Copy / labels for withdrawable balance (grep did not show `$` lines in slice — **UNCERTAIN:** full file may format amounts elsewhere) | wallet / API | UNC | **Convert** |
| `UserAffiliatePage.tsx` | 169–179, 503, 553–557 | Commission totals / table | `commissions` | `Intl` USD / `$0.00` | **Convert** (commissions stored with `currency` from DB — may already be multi-currency; UI forces USD style in places) |
| `UserPositionsPage.tsx` | 182 | PnL **percent** only in grep sample | `pnlPercent` | `toFixed(2)%` | **N/A** |

**Transactions:** User-facing transaction lists may also appear in terminal `PaymentPanel` / admin-only views; dedicated user “transactions” page not exhaustively listed — **UNCERTAIN** if separate route exists outside `userPanel`.

---

# 4. ADMIN PANEL — MONETARY DISPLAY SURFACE

Grouped by area (representative files; not every cell duplicated — follow imports of `formatCurrency` and `$` patterns).

## Admin users

| File | Line(s) / area | Monetary cells | Whose currency? |
|------|----------------|----------------|-----------------|
| `UsersTable.tsx` | (uses shared `formatCurrency` per grep) | Balance / equity columns if present | **Admin’s own** vs **platform default** for aggregates — **UNCERTAIN** column set without full row read |
| `UserDetailsModal.tsx` | grep: many `formatCurrency` hits (~19) | Wallet, PnL, deposits, etc. | **Viewed user’s** effective display currency |
| `MultiUserMetricsModal.tsx` | multiple | Aggregated metrics | **Platform default** or **admin** — product decision |
| `CreateEditUserModal.tsx` | financial + timezone | Editable user fields | N/A until `display_currency` added |

## Admin trading

| File | Role | Whose currency? |
|------|------|-----------------|
| `AdminTradingPage.tsx` | Local `formatCurrency` + live filters | List: **platform**; drill-down: **viewed user** |
| `OrdersAdminPanel.tsx` / `PositionsAdminPanel.tsx` | Table cells | **Viewed user** when scoped to one user |
| `OrderDetailsModal.tsx`, `PositionDetailsModal.tsx`, `EventDetailsModal.tsx` | Detail amounts | **Viewed user** |
| `LivePnlCell.tsx` | Live PnL | **Viewed user** |
| `TradingStatsCards.tsx` | Summary stats | **Platform** / scoped cohort |

## Admin finance

| File | Role | Whose currency? |
|------|------|-----------------|
| `FinanceOverviewPanel.tsx` | Dashboard-style totals | **Platform default** |
| `FinanceTransactionsPanel.tsx`, `FinanceWalletsPanel.tsx` | Rows | **Per-row user** (wallet owner) |
| `TransactionDetailsModal.tsx`, `WalletDetailsModal.tsx`, `ManualAdjustmentModal.tsx` | Detail | **Wallet owner user** |

## Dashboard (`src/features/dashboard/`)

| File | Role | Whose currency? |
|------|------|-----------------|
| `DashboardPage.tsx`, `RevenueChart.tsx`, `FeesChart.tsx` | Revenue / fees | **Platform default** |

## Managers

| `ManagerDetailPage.tsx` | many numeric displays (grep count high) | **Platform** or attributed users — clarify with PM |

## Leads

| `LeadsTable.tsx`, `AdminLeadDetailPage.tsx` | No monetary grep in quick scan | **N/A** or future CRM fields — **UNCERTAIN** |

## Markup / leverage

| `PriceStreamProfilesPanel.tsx`, `ProfileDetailsModal.tsx`, `SymbolPriceOverridePanel.tsx`, `ManageTiersModal.tsx` | Notional / tier amounts | **Platform** (configuration), not trader preference |

## Funded programs / bonus / system

| `AdminFundedProgramsPage.tsx`, `AdminFundedPlanDetailPage.tsx`, `CreatePlanWizard.tsx` | Plan values | **Platform** |
| `BonusPage.tsx` | Bonus admin UI | **Viewed user** / **platform** |
| `SystemPage.tsx` | System metrics | **Platform** |
| `BulkDepositSection.tsx` | Bulk deposit amounts | **Target users** |

## AI reports / appointments

**UNCERTAIN** without full grep pass — likely lower monetary density than finance/trading.

---

# 5. EXISTING NON-USD HANDLING — CRITICAL

## Symbol metadata

- **`symbols.quote_currency`** exists in **`database/schema.sql`** (and `database/migrations/0005_symbols_schema.sql`); seeded examples in `database/migrations/0033_seed_binance_symbols.sql`, `0034_seed_mmdps_forex_symbols.sql` (e.g. forex crosses).
- **Auth / admin API** exposes `quote_currency`: `backend/auth-service/src/routes/admin_symbols.rs`, `backend/auth-service/src/routes/symbols.rs`, models `backend/auth-service/src/models/symbol.rs`.

## Order engine — PnL math (e.g. GBPHUF)

**Lua `apps/order-engine/lua/atomic_close_position.lua`** (lines 81–85):

- LONG: `pnl = (exit_price - entry_price) * actual_close_size`
- SHORT: `pnl = (entry_price - exit_price) * actual_close_size`

**Dimensions:** `price` and `entry_price` are in **the same numeric space as ticks** for that symbol. For GBPHUF, that is **HUF per GBP** × **GBP size** → **HUF-denominated PnL** (not implicitly USD).

**Lua `atomic_fill_order.lua`:** Same tick/price space for fills; margin uses `fill_price * size / leverage` style math in Rust/Lua path — **margin in quote currency units** for that symbol.

## Account summary — aggregating unrealized across symbols

**`backend/auth-service/src/routes/deposits.rs`** — `fetch_position_aggregates_from_redis` (lines 736–803):

- Recomputes unrealized as `(bid - avg_price) * size` (LONG) or `(avg_price - ask) * size` (SHORT) using Redis **bid/ask** and position **avg_price** / **size**.
- **No** `quote_currency` lookup and **no** FX conversion to a single numeraire in this function.
- **Implication:** Summing unrealized across GBPHUF + BTCUSD **adds HUF numbers to USD numbers** unless all deployed symbols are USD-quoted. **RED FLAG** for “single USD equity” assumption.

## `convert_to_usd` / `to_account_currency`

Repo-wide search for `exchange_rate`, `fx_rate`, `convert_to_usd`, `to_account_currency`, `currency_rate`, `forex_rate`: **no meaningful hits** in application logic (only unrelated uses if any). **UNCERTAIN** if legacy code paths exist under different names.

## Exchange rate tables / Redis keys

- **No** dedicated `exchange_rates` table found in scanned migrations.
- **No** `rate:`, `fx:`, `exchange:` Redis key conventions found in code search for this diagnostic.

## `positions` table storage

**DB fallback** in `deposits.rs:826`–`834`: `SUM(pnl)` for open/closed positions. **Type:** numeric; **unit:** symbol/trade convention from engine — **not forced to USD in SQL**.

**Redis hashes** (`unrealized_pnl`, `realized_pnl`, `margin`): populated from order-engine events/Lua — **same dimensional analysis as above** → for non-USD quotes, values are **in quote currency**, not “already USD”.

## `crates/risk/src/margin.rs`

Pure **`size * entry_price / leverage`** (lines 5–8) — **no currency conversion**; numeric margin in **price × size** units.

## `apps/order-engine/src/engine/order_handler.rs`

Margin / notional from `fill_price * order.size` (see grep ~371, 481) — **quote-space** numerics, passed to Lua / Redis.

### Summary for layering the new feature

- **Existing “conversion”** is **not** a global USD normalization layer; it is **consistent math in each symbol’s tick/price space**.
- Display currency for **account-level** aggregates requires **explicit FX** (or restricting product to USD-quoted-only). **Do not duplicate** per-symbol quote logic; add a **separate display-layer** (or server-side **enriched DTOs**) that converts **known-USD ledger** fields and/or **normalized equity** once that invariant is defined.

---

# 6. BACKEND — WHAT VALUES SHIP TO THE CLIENT

| Endpoint (approx.) | Handler file | Monetary fields | Currency / notes |
|--------------------|--------------|-----------------|------------------|
| `GET /api/auth/me` | `backend/auth-service/src/routes/auth.rs` (`me` ~1120; `UserResponse` ~110–166) | **None** in `UserResponse` — identity, permissions, **timezone** trio | N/A |
| `GET /api/account/summary` | `deposits.rs` (`AccountSummary` ~514–533; handlers ~1907+) | `balance`, `equity`, `marginUsed`, `freeMargin`, `realizedPnl`, `unrealizedPnl`, `bonus`, thresholds | **Declared as `f64` JSON** — business meaning “USD account” **UNCERTAIN** under mixed quote symbols (§5) |
| `GET /api/wallet/balance` | `deposits.rs` (`get_wallet_balance`); TS `WalletBalanceResponse` in `src/features/wallet/api.ts:16`–`24` | `available`, `locked`, `equity`, `marginUsed`, `freeMargin`, `currency` string | `currency` from wallet row — typically **ledger currency** (schema `wallets.currency`) |
| `GET /v1/users/:user_id/positions` | `deposits.rs` (`get_user_positions` ~3798+) | Position JSON: margin, avg, pnl, sizes, etc. | **Symbol quote / engine units** |
| `POST /v1/orders/estimate` | `orders.rs:773`–`867` (`EstimateOrderMarginResponse`) | `notional`, `effectiveLeverage`, `requiredMargin`, `executionPrice` — all **strings** (`Decimal` serialized) | **Same units as engine** (not display-currency converted) |
| `GET /v1/orders/` | `orders.rs` (`list_orders`, etc.) | Order sizes, prices, filled averages | Engine / symbol space |
| `GET /api/deposits/` (user) | `deposits.rs` | Deposit amounts | **UNC:** likely USD ledger |
| `GET /api/account/deposits` | UNC if distinct from above — verify router `create_account_router` | | |
| `GET /api/notifications` | `deposits.rs` `get_notifications` ~3015+ | `message` is **pre-rendered text**; `meta` may include `amount` | Messages like **`Your deposit of $…`** (`deposits.rs:2739`, `:2754`) — **USD literal in string** |

## Admin

| Endpoint | Handler | Monetary fields |
|----------|---------|-----------------|
| `GET /api/admin/users/.../summary` (exact path in `admin_users.rs`) | `admin_users.rs` (uses `get_account_summary_for_user`) | Same shape as `AccountSummary` |
| `GET /api/admin/finance/overview` | `finance.rs:467`+ | `total_balances`, `deposits_today.amount`, `withdrawals_today.amount`, `net_fees_today` — **`Decimal` → JSON string UNC** (verify serde) |
| `GET /api/admin/finance/transactions` | `finance.rs:769`+ | Transaction `amount`, `fee`, `net_amount`, `currency` |
| `GET /api/admin/finance/wallets` | `finance.rs:932`+ | `available_balance`, etc., per wallet |

---

# 7. USER & GROUP SCHEMA

## `users`

- From migrations: **no** `display_currency` / `preferred_currency` **today**.
- **`timezone`** added in `infra/migrations/063_timezone_columns.sql` lines 11–15 (and duplicate in `backend/auth-service/migrations/20260524100000_timezone_columns.sql`).

## `user_groups`

- **`timezone`** column: `063_timezone_columns.sql` lines 3–7.
- **No** `display_currency` column in scanned migrations.

## `platform_general_settings.currency`

- **Exists:** `infra/migrations/060_platform_general_settings.sql` line 8 — `currency TEXT NOT NULL DEFAULT 'USD'`.
- **Read/write today:** `backend/auth-service/src/routes/admin_settings.rs` `get_general_settings` / `put_general_settings` (SELECT / UPDATE including `currency`, lines ~155–213).
- **Other reads:** Grep of `backend/` for `platform_general_settings` shows **`effective_timezone.rs` reads `timezone` only** and **`admin_settings.rs`**. **No other consumer of `currency`** found → **effectively dead for runtime formatting**, alive for **admin CRUD** only.

## `wallets.currency` / `transactions.currency`

- **`database/schema.sql:196`–`214`:** `wallets.currency VARCHAR(10) NOT NULL`; `transactions.currency VARCHAR(10) NOT NULL`.
- **Typical values:** **UNCERTAIN** distribution; deposit paths in `deposits.rs` often assume **USD** ledger (e.g. approved event `currency: "USD"` ~2702).

## `symbols.quote_currency`

- Confirmed in `database/schema.sql` / migrations; API surfaces as `quote_currency`.

---

# 8. `/api/auth/me` CURRENT PAYLOAD

**Rust struct:** `backend/auth-service/src/routes/auth.rs` `UserResponse` **lines 110–166**.

**Fields include:** `id`, `email`, names, `role`, `status`, `phone`, `country`, timestamps, referral, `group_id`, `group_name`, leverage fields, profiles, `account_type`, `margin_calculation_type`, `trading_access`, `open_positions_count`, permission profile + `permissions`, `hide_leverage_in_terminal`, **`timezone`**, **`group_timezone`**, **`effective_timezone`**, **`effective_timezone_origin`**.

**Insertion point for currency:** Mirror timezone: optional **`display_currency`**, **`group_display_currency`**, **`effective_display_currency`**, **`effective_display_currency_origin`** (names TBD), resolved server-side with same cascade as product spec.

---

# 9. ADMIN GROUP & USER EDIT FORMS

## Group create/edit — `GroupFormDialog.tsx`

- **Schema / fields:** `name`, `description`, `status`, `margin_call_level`, `stop_out_level`, `signup_slug`, `hide_leverage_in_terminal`, **`timezone`** (`GroupFormDialog.tsx:16`–`25`, defaults ~59–79).
- **Timezone UI:** `TimezoneSelect` import line 13; platform default from `getGeneralSettings` (~42–48). **Further lines** (render of `TimezoneSelect`): **UNC:** past line 80 in file (dialog body).
- **Backend:** `backend/auth-service/src/routes/admin_groups.rs` — DTO includes `timezone` (~31–33, ~49); `update_group` binds `payload.timezone` (~443, ~492).

## User create/edit — `CreateEditUserModal.tsx`

- **Timezone:** `TimezoneSelect` ~351–353; form schema includes `timezone` and effective timezone read-only fields (~32–85).
- **Backend user update:** **UNC:** exact handler file/line in this pass — likely `admin_users.rs` PATCH; grep in implementation phase.

---

# 10. PLATFORM SETTINGS

- **UI:** `src/features/settings/pages/SettingsPage.tsx` — “Default Currency” select **lines 446–458**; state `defaultCurrency` (~87); save payload `currency: defaultCurrency` (~204); load `setDefaultCurrency(d.currency)` (~175).
- **API:** `src/features/settings/api/generalSettings.api.ts` — `GET/PUT /api/admin/settings/general` with `{ siteName, timezone, currency }`.
- **Backend persistence:** `admin_settings.rs` (§7).
- **Runtime reads:** **None** outside admin settings API — **dead for client formatting today** (matches expectation).

---

# 11. EXISTING SHARED CURRENCY UTILITIES

- **`src/shared/utils/currency.ts`** — documented in §1.
- **Duplicates:** `leverageProfiles/utils/format.ts`, inline in `AdminTradingPage.tsx`, `AdminTransactionsPage.tsx`.
- **Mirror for timezone:** `src/shared/datetime/index.ts` exports types, `resolve`, `format`, `context`, `hooks` — **currency** should likely get `src/shared/currency/` or `src/shared/money/` with `resolveEffectiveCurrency`, `CurrencyProvider`, `useFormatMoney` (planning only).

---

# 12. EXCHANGE RATE INFRASTRUCTURE

- **No** application tables or jobs found for FX in this diagnostic pass (search terms: `exchange_rate`, `fx_rate`, `forex_rate`, `currency_rate`, Redis `rate:` / `fx:`).
- **New work:** hourly job + Redis (or small SQL cache) **from scratch** in this repo.

---

# 13. PERMISSION KEYS

- Scanned `infra/migrations/019_permission_definitions.sql` — **no** `currency:*` permission string.
- **Expectation:** Reuse `settings:edit` / `groups:edit` / `users:edit` like timezone — **no dedicated currency permission found**.

---

# 14. CHART AND TICK INFRASTRUCTURE (sanity)

- **`backend/ws-gateway`:** Broadcaster forwards JSON payloads as **`ServerMessage::Tick`** etc. (`stream/broadcaster.rs` ~67) — **no currency conversion** in gateway.
- **Auth-service:** `deposits.rs:645`–`647` documents Redis key `prices:{symbol}:{group}` JSON with `bid`/`ask` strings — **raw quote prices**.
- **`klinecharts`:** Client chart library (`package.json:30`) consumes **the same tick/price stream** the terminal uses — **stay in native symbol precision**.
- **Order engine:** Consumes ticks / prices for matching and margin in **symbol space** — **must not** receive display-currency-converted values.

**Conversion line:** **UI (and optional API DTO enrichment) only** for account-level display; **never** mutate tick stream or matcher inputs for display currency.

---

# 15. COUNT & ESTIMATE

| Metric | Estimate | Method |
|--------|----------|--------|
| **Distinct monetary render sites (UI)** | **115** (estimate) | ~45+ in `BottomDock.tsx` alone; + terminal sidebar/history/right panel; + userPanel; + admin finance/trading/dashboard/managers; **UNCERTAIN:** ±25 without exhaustive line-by-line UI audit |
| **Files touched if consolidating `useFormatCurrency()`** | **68** (estimate) | `formatCurrency` / `$` / `Intl` across **35+** `.tsx` files from pattern grep + additional templates and `.ts` helpers |
| **Backend handlers that must “know” about currency** | **0–3** | **0** if conversion is purely client-side from cached FX + unchanged numeric APIs; up to **~3** touch points if you fix **preformatted notification** strings (`deposits.rs` ~2739) and optionally add resolved currency fields on `/me` / summaries |
| **Background jobs to add** | **1** | Rate fetcher |
| **New columns / tables** | `users.display_currency`, `user_groups.display_currency` (nullable); **optional** `exchange_rates` table or Redis keys `fx:{base}:{quote}`; wire `platform_general_settings.currency` into resolution | As per product |
| **Effort** | **~4–8 engineer-days** core + **2–4 days** QA/product | Faster if symbols are USD-only in prod; **much longer** if mixed-quote + correct equity normalization is required |

## vs timezone feature

- **Harder than timezone** if: mixed-quote positions + single equity number must become **numerically correct** (not just relabeled `$`).
- **Easier** if: production symbol set is **USD-quoted only** and display currency is **cosmetic FX** on **ledger USD** fields only.
- **Lessons from timezone:** Central `resolve` + `Provider` + `/me` payload fields worked well — **repeat** for currency; avoid duplicating formatters (Phase 4 `datetime` cleanup pattern).

---

# 16. WHAT’S OUT OF SCOPE

Confirm **unchanged** (internal USD or symbol-native only):

- Tick / price stream (`price:ticks`, `prices:{symbol}:{group}`, NATS tick subjects)
- Order matching engine and fill pricing
- Position margin calculations in engine / Lua
- SL/TP trigger evaluation
- Margin call / stop-out logic
- Swap charging
- Idempotency keys / internal Redis structure
- **Canonical numeric storage** in DB for ledger balances (remains **account currency / USD as today** unless a separate ledger migration is planned)

---

## Non-monetary uses of `$` (excluded)

- **Template literals** for non-currency: e.g. `` `${label} copied` `` in `BottomDock.tsx:44`; **idempotency_key** / random strings in `ChartTradingStrip.tsx:128`.
- **JSX `className`** templates containing `$` for Tailwind arbitrary values — rare; verify per-file when refactoring.

---

## Red flags (design / engineering)

1. **Mixed-quote unrealized PnL summed without FX** in `fetch_position_aggregates_from_redis` — equity may be **dimensionally inconsistent** if forex crosses are traded.
2. **UI always prefixes `$`** on position PnL / margin / prices — **misleading** for HUF/JPY quotes even before display-currency work.
3. **Server-built notification strings** hardcode `$` (`deposits.rs:2739`) — breaks i18n and future display currency unless migrated to structured `meta` + client formatting.
4. **`EstimateOrderMarginResponse` field names** imply “USD” in frontend variable names (`marginUsd`) while math is **symbol-native** — naming debt risks wrong conversion layer.

---

*End of diagnostic.*
