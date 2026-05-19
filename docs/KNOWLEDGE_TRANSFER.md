# NEWPT Trading Platform — Technical Knowledge Transfer

> Generated from codebase at `/Users/mab/new_pt1`. Primary API: **`backend/auth-service`** (Axum, port **3000**). Production stack: `deploy/docker-compose.prod.yml`.

---

## 1. Project Overview

- **What it is:** **NEWPT** (`database/schema.sql` header: "Professional CFD/Margin Trading Platform") — a white-label broker-style platform where retail traders open margin positions on multiple asset classes; staff manage users, pricing, risk, finance, CRM (leads, appointments, KYC), and support from an admin panel.
- **Trading type:** **CFD / margin** across **`market_type`** enum values: `crypto`, `forex`, `commodities`, `indices`, `stocks`. Crypto prices primarily from **Binance**; forex/equities/commodities from **MMDPS** (`backend/data-provider`, `MMDPS_*` env). Not a central limit-order book exchange — execution is **in-house** via **`apps/order-engine`** against streamed ticks.
- **Users:** **Traders** (`users.role = 'user'`), **platform admins** (`admin`, `super_admin`), **managers** (`managers` table + `permission_profile_id`), **agents** (admin-panel role in `AdminGuard`). Sub-admins are **managers** with scoped access via **tags → groups** (`backend/auth-service/src/routes/scoped_access.rs`).

---

## 2. Tech Stack

### Frontend

| Layer | Choice |
|--------|--------|
| Framework | **React 18** + **TypeScript** |
| Build | **Vite 5** (`package.json`, `vite.config.ts`) |
| Routing | **react-router-dom v6** (`src/app/router/`) |
| UI | **Tailwind CSS**, **Radix UI**, **Headless UI**, **lucide-react**, **class-variance-authority** |
| State | **Zustand** (`src/shared/store/auth.store.ts`), **TanStack React Query** (no `refetchInterval` per workspace rule) |
| Tables | **@tanstack/react-table** + **react-virtual** |
| Charts | **klinecharts** (`klinecharts` in `package.json`) — terminal charts |
| Forms | **react-hook-form** + **zod** |

### Backend

| Service | Stack | Role |
|---------|--------|------|
| **auth-service** | Rust, **Axum 0.7**, **sqlx**, **tokio** | Main REST API (auth, admin, orders, deposits, KYC, …) |
| **order-engine** | Rust, Axum-less worker | NATS consumer; Redis Lua; fills/cancels/positions |
| **ws-gateway** | Rust, Axum WS | Real-time ticks, balances, notifications, support chat |
| **data-provider** | Rust (`backend/data-provider`, `apps/data-provider`) | Binance + MMDPS feeds → Redis/NATS |
| **core-api** | Rust, Axum | Legacy/parallel API; persistence consumer; auth stubs return "not available" |

Workspace: root **`Cargo.toml`** members under `apps/` and `crates/`.

### Database

- **PostgreSQL 16** (dev: `infra/docker-compose.yml`, host port **5434**, DB **`newpt`**)
- **ORM:** **sqlx** (compile-time queries in auth-service; migrations in `infra/migrations/` and `backend/auth-service/migrations/`)
- Reference schema: **`database/schema.sql`** (design doc; runtime evolved via `infra/migrations/`)

### Real-time

- **WebSocket:** `ws-gateway` at `/ws` (dev proxy: `ws://127.0.0.1:3003` in `vite.config.ts`)
- **NATS JetStream** (optional fallback to pub/sub): order commands, events, ticks subject prefix `ticks.`
- **Redis:** pub/sub (`wallet:balance:request`, `price:ticks`, `account:summary:{user_id}`), hot state (`crates/redis-model/src/keys.rs`)
- **No polling** in UI (workspace rule `.cursor/rules/no-polling.mdc`)

### Auth

- **JWT** access tokens (`jsonwebtoken`, `backend/auth-service/src/utils/jwt.rs`)
- **Refresh tokens** in **`user_sessions`** (`refresh_token_hash`, `is_revoked`)
- Claims: `sub` (user UUID), `email`, `role`, `group_id`, `exp`, `iat`
- Env: `JWT_SECRET`, `ACCESS_TOKEN_TTL_SECONDS` (default 900), `REFRESH_TOKEN_TTL_SECONDS` (default 30d)

### Hosting / deployment

- **`deploy/docker-compose.prod.yml`:** `postgres`, `redis`, `nats`, `migrations`, `auth`, `ws-gateway`, `order-engine`, `data-provider`, `frontend` (nginx)
- **`deploy/.env.production.example`:** `POSTGRES_PASSWORD`, `JWT_SECRET`, `MMDPS_API_KEY`, `VITE_VOISO_PANEL_URL`, `VOISO_API_KEY`
- Dev: Vite **5173** → proxies `/api`, `/v1` → auth **3000**; `/ws` → **3003**; `/dp` → data-provider HTTP **9004**

### Third-party / integrations

| Service | Usage |
|---------|--------|
| **Binance WebSocket** | Crypto ticks (`BINANCE_WS_URL`) |
| **MMDPS** | Forex/CFD feed + chart history (`MMDPS_API_KEY`, `MMDPS_WS_BASE`, `MMDPS_HISTORY_BASE`) |
| **Voiso** | Click2call + embedded omnichannel panel (`platform_voiso_config`, `VOISO_API_KEY`) |
| **SMTP** | `platform_email_config`, `platform_email_templates` |
| OAuth | **N/A** — email/password only |

---

## 3. Folder Structure

```
new_pt1/
├── src/                    # React SPA (trading-ui)
│   ├── app/                # Router, layout, config (nav.ts), providers, store
│   ├── features/           # Feature modules (terminal, adminUsers, kyc, …)
│   ├── shared/             # UI, api, ws, hooks, guards, utils
│   └── pages/auth/         # Login, Register, Impersonate
├── backend/
│   ├── auth-service/       # Main API + business logic (port 3000)
│   ├── ws-gateway/         # WebSocket gateway (WS 3003, health HTTP 9002)
│   └── data-provider/      # Price feed service (WS/HTTP ports via env)
├── apps/
│   ├── order-engine/       # Order execution worker (NATS + Redis Lua)
│   ├── core-api/           # Alternate API + DB persistence consumer
│   ├── gateway-ws/         # Additional WS gateway variant
│   └── data-provider/      # Alternate data-provider app
├── crates/
│   ├── contracts/          # Shared enums, PlaceOrderCommand, VersionedMessage
│   ├── redis-model/        # Redis key builders (Keys::*)
│   ├── risk/               # effective_leverage, margin, liquidation helpers
│   └── common/             # Shared config (DATABASE_URL, NATS, Redis)
├── database/               # schema.sql + older migrations
├── infra/
│   ├── migrations/         # Production SQL migrations (applied in deploy)
│   ├── docker-compose.yml  # Dev postgres/redis/nats
│   └── scripts/
├── deploy/                 # Production Docker Compose + Dockerfiles
├── docs/                   # Design docs (USER_EVENTS_*, etc.)
└── scripts/                # Dev/ops shell scripts
```

---

## 4. Database Schema

**Note:** Live DB is **`infra/migrations/`** + **`backend/auth-service/migrations/`**. `database/schema.sql` is a consolidated design reference; some column names differ in runtime (e.g. `leverage_profile_tiers` vs `leverage_tiers`).

### Core trading & users

| Table | Key columns | Relationships / notes |
|-------|-------------|------------------------|
| **users** | `id`, `email`, `password_hash`, `first_name`, `last_name`, `role` (`user`/`admin`/`super_admin`/manager flows), `group_id`, `permission_profile_id`, `trading_access` (`full`/`close_only`/`disabled`), `kyc_status`, `referral_code`, `referred_by_user_id`, `deleted_at`, `account_type`, `margin_calculation_type`, leverage min/max caps | FK → `user_groups`, `permission_profiles`, `affiliates` |
| **user_groups** | `name`, `default_price_profile_id`, `default_leverage_profile_id`, `trading_enabled`, `withdraw_enabled`, `close_only`, `signup_slug`, `hide_leverage_in_terminal`, `created_by` | Group-level defaults |
| **user_sessions** | `user_id`, `refresh_token_hash`, `ip`, `user_agent`, `expires_at`, `is_revoked` | Refresh token storage |
| **managers** | `user_id` UNIQUE, `permission_profile_id`, `status` (`active`/`disabled`) | Staff; syncs `users.permission_profile_id` |
| **symbols** | `code`, `market`, `base_currency`, `quote_currency`, `contract_size`, `tick_size`, `lot_min`/`lot_max`, `leverage_profile_id`, `data_provider`, `trading_enabled` | Tradable instruments |
| **group_symbols** | `group_id`, `symbol_id`, per-group `leverage_profile_id`, overrides | Per-group symbol config |
| **orders** | `user_id`, `symbol_id`, `side` (`order_side`), `type` (`order_type` enum: market/limit/stop/stop_limit in schema; API accepts **MARKET/LIMIT only**), `size`, `price`, `stop_price` (SL), `filled_size`, `average_price`, `status` (`order_status`), `reference` | Inserted by `place_order`; synced from engine via `evt.order.updated` |
| **positions** | `user_id`, `symbol_id`, `side`, `size`, `entry_price`, `mark_price`, `leverage`, `margin_used`, `liquidation_price`, `pnl`, `status` | Hot copy in Redis; DB via `evt.position.updated` |
| **balances** | `user_id`, `currency`, `available`, `locked`, `equity`, `margin_used`, `free_margin` | Legacy/simple balance row (`infra/migrations/001_initial_schema.sql`) |
| **wallets** | `user_id`, `wallet_type` (`spot`/`margin`/`funding`), `available_balance`, `locked_balance` | Used by `calculate_wallet_balance` in deposits |
| **transactions** | `type`, `amount`, `status`, `method`, `reference`, `deposit_request_id` | Ledger of deposits/withdrawals/adjustments |
| **deposit_requests** | `user_id`, `amount`, `currency`, `status` (`PENDING`/…), `admin_id`, `approved_at`, `rejected_at` | User deposit flow |
| **ledger_entries** | `wallet_id`, `delta`, `balance_after`, `ref` | Wallet audit trail (schema.sql) |

### Pricing, leverage, swap

| Table | Purpose |
|-------|---------|
| **price_stream_profiles** | Bid/ask markup profiles (`markup_type`, `bid_markup`, `ask_markup`) |
| **symbol_markup_overrides** | Per-symbol markup |
| **leverage_profiles** | Named profiles; `is_default` flag |
| **leverage_profile_tiers** / **leverage_tiers** | Notional bands → `max_leverage`, margin % (runtime uses `leverage_profile_tiers` in SQL) |
| **symbol_leverage_profile_assignments** | Symbol-level leverage profile |
| **swap_rules** | Overnight swap per `group_id` + `symbol_id` |

### Permissions & admin

| Table | Purpose |
|-------|---------|
| **permission_categories** | UI grouping |
| **permissions** | `permission_key`, `label`, `category_id` |
| **permission_profiles** | Named role templates |
| **permission_profile_grants** | `(profile_id, permission_key)` PK |
| **admin_actions**, **audit_logs**, **audit_events** | Audit trails |
| **activity_logs** | User/admin activity |

### CRM & support

| Table | Purpose |
|-------|---------|
| **leads**, **lead_activities** | CRM pipeline |
| **appointments** | Scheduled meetings |
| **kyc_submissions**, **kyc_documents** | KYC workflow |
| **support_messages** | Support chat persistence |
| **tags**, **tag_assignments** | Scoping (managers see users in tagged groups) |
| **user_notes** | Admin notes on users |
| **user_events** | Append-only user activity (`event_type`, `category`, `ip`, `user_agent`, `meta`) |
| **notifications** | In-app notifications |
| **terminal_promotion_slides** | Terminal carousel |
| **admin_call_records** | Voiso/admin call logging |
| **affiliates**, **affiliate_commission_layers**, **affiliate_commissions** | Referral program |

### Platform config

| Table | Purpose |
|-------|---------|
| **platform_email_config**, **platform_email_templates** | SMTP + templates (`welcome`, `password_reset`, …) |
| **platform_data_provider_integrations** | MMDPS/Binance config synced to Redis |
| **platform_voiso_config** | Voiso API settings |
| **user_terminal_preferences** | Terminal UI prefs JSON |
| **password_reset_tokens** | OTP/password reset |
| **crm.email_templates**, **crm.idempotency_keys** | CRM schema (`infra/migrations/003_crm_schema.sql`) |

### Highlight enums (`database/schema.sql`)

- `order_status`: pending, filled, cancelled, rejected, partially_filled
- `position_status`: open, closed, liquidated
- `transaction_type`: deposit, withdrawal, adjustment, fee, rebate
- `kyc_status`: none, pending, verified, rejected

---

## 5. Authentication & Access Control

### Login / registration flow

1. **POST `/api/auth/register`** — `AuthService::register` creates `users` with `role='user'`, assigns group via `group_id` or signup slug `ref` (`RegisterRequest.signup_ref`).
2. **POST `/api/auth/login`** — validates password, issues JWT + refresh session in **`user_sessions`**, logs **`user_events`** (login).
3. **POST `/api/auth/refresh`** — new access token from refresh token.
4. **POST `/api/auth/logout`** — revokes session.
5. Password reset: **`/api/auth/password-reset/request|verify|confirm`** (OTP + `password_reset_tokens`).
6. **GET `/api/auth/me`** — current user profile + permissions list for managers.
7. **POST `/api/admin/users/:id/impersonate`** — admin obtains trader token (`ImpersonatePage` at `/impersonate`).

Middleware: **`auth_middleware`** (`backend/auth-service/src/middleware/auth_middleware.rs`) — Bearer JWT → `Claims` in request extensions.

### Roles (JWT `Claims.role` / `users.role`)

| Role | Meaning |
|------|---------|
| **user** | Retail trader; terminal `/`, user panel `/user/*` |
| **admin** | Full admin bypass for `permission_check` (except profile-only checks) |
| **super_admin** | Unrestricted; can edit "Full Access" permission profile rules |
| **manager** | Admin UI via `AdminGuard`; permissions from **`permission_profile_grants`** |
| **agent** | Listed in `AdminGuard` allowed roles (same panel access pattern as manager) |

**Managers** are also rows in **`managers`** linking `user_id` → `permission_profile_id`.

### Permission enforcement

- **`permission_check::check_permission`** (`backend/auth-service/src/utils/permission_check.rs`): `admin`/`super_admin` → allow; else require grant on user's `permission_profile_id`.
- **`check_permission_profile_only`**: no admin bypass (used for `kyc:approve`).
- **Scoped data:** **`scoped_access::resolve_allowed_group_ids`** — managers with tags only see users in matching groups; plain `admin` without `managers` row sees all.
- Frontend: **`adminNavItems`** in `src/app/config/nav.ts` filter by `permission`; **`AdminGuard`** / **`UserGuard`** gate routes.

### Permission keys (from migrations; authoritative list in DB table **`permissions`**)

**Trading & finance**

- `trading:view`, `trading:place_orders`, `trading:create_order`, `trading:cancel_order`, `trading:close_position`, `trading:liquidate`
- `deposits:approve`, `deposits:reject`, `finance:view`, `finance:manual_adjustment`

**Support**

- `support:view`, `support:reply`, `support:new_chat`

**Users & groups**

- `users:view`, `users:create`, `users:edit`, `users:bulk_create`
- `users:edit_group`, `users:edit_account_type`, `users:edit_margin`, `users:edit_trading_access`
- `user_events:view`
- `groups:view`, `groups:create`, `groups:edit`, `groups:delete`, `groups:symbol_settings`, `groups:price_profile`, `groups:tags`
- `managers:view`, `managers:create`, `managers:edit`, `managers:delete`
- `tags:view`, `tags:create`, `tags:edit`, `tags:delete`

**Configuration**

- `symbols:view`, `symbols:edit`, `symbols:create`, `symbols:delete`
- `markup:view`, `markup:edit`, `markup:create`, `markup:delete`
- `swap:view`, `swap:edit`, `swap:create`, `swap:delete`
- `leverage_profiles:view`, `leverage_profiles:edit`, `leverage_profiles:create`, `leverage_profiles:delete`
- `promotions:view`, `promotions:edit`

**Risk & reports**

- `risk:view`, `risk:edit`, `reports:view`

**Other admin**

- `dashboard:view`, `bonus:view`, `bonus:edit`
- `affiliate:view`, `affiliate:edit`, `affiliate:create`, `affiliate:delete`
- `permissions:view`, `permissions:edit`
- `system:view`, `settings:view`, `settings:edit`
- `call:view`
- `appointments:view`, `appointments:create`, `appointments:edit`, `appointments:delete`, `appointments:reschedule`, `appointments:cancel`, `appointments:complete`, `appointments:send_reminder`
- `leads:view`, `leads:create`, `leads:edit`, `leads:convert`, `leads:assign`, `leads:delete`, `leads:export`
- `kyc:view`, `kyc:approve`

---

## 6. Panels & Their Features

### Trading Terminal (`/`, `TerminalPage`)

- **Routes:** `/` (default after login), `/user/trading` → `TradingPage` (secondary)
- **Features:** Live chart (klinecharts), order ticket (market/limit), positions/orders panels, symbol watchlist, SL/TP on orders, account summary (equity, margin, free margin, unrealized PnL), promotion slides
- **Access:** Authenticated **`user`** (`AuthGuard`); admins impersonating or using terminal directly
- **Real-time:** `src/shared/ws/wsClient.ts` → `/ws`; subscribe ticks; balance channel for traders

### User Panel (`/user/*`, `UserLayout`)

| Route | Page | Purpose |
|-------|------|---------|
| `/user/dashboard` | `UserDashboardPage` | Account overview |
| `/user/profile` | `UserProfilePage` | Profile settings |
| `/user/kyc` | `UserKycPage` | Upload/submit KYC |
| `/user/positions` | `UserPositionsPage` | Position history |
| `/user/orders` | `UserOrdersPage` | Order history |
| `/user/funded-program` | `UserFundedProgramsPage` | Prop/funded programs (**mock data**; TODO API) |
| `/user/appointments` | `UserAppointmentsPage` | User appointments |
| `/user/affiliate` | `UserAffiliatePage` | Referral stats |
| `/user/support` | `UserSupportPage` | Support chat |
| `/user/deposit` | `UserDepositPage` | Deposit requests |
| `/user/withdraw` | `UserWithdrawPage` | Withdrawal requests |

- **Access:** `role === 'user'` (`UserGuard` redirects admin/manager to `/admin/dashboard`)

### Admin Panel (`/admin/*`, `AdminLayout`)

| Route | Feature module | Permission (nav) |
|-------|----------------|------------------|
| `/admin/dashboard` | Dashboard | `dashboard:view` |
| `/admin/users` | User management, impersonate, account summary | `users:view` |
| `/admin/user-events` | User activity history | `user_events:view` |
| `/admin/bulk-operations` | Bulk user import | `users:bulk_create` |
| `/admin/groups` | User groups, symbol settings | `groups:view` |
| `/admin/manager` | Managers CRUD + stats | `managers:view` |
| `/admin/trading` | Orders/positions admin view | `trading:view` |
| `/admin/leverage-profiles` | Leverage tiers | `leverage_profiles:view` |
| `/admin/symbols` | Symbol catalog, MMDPS sync | `symbols:view` |
| `/admin/markup` | Price stream profiles | `markup:view` |
| `/admin/promotions` | Terminal slides | `promotions:view` |
| `/admin/funded-programs` | Funded programs (**UI mock**) | `dashboard:view` |
| `/admin/swap` | Swap rules | `swap:view` |
| `/admin/transactions` | Finance/deposits/withdrawals | `finance:view` |
| `/admin/bonus` | Bonus UI | `bonus:view` (**no dedicated backend routes found**) |
| `/admin/affiliate` | Affiliate layers | `affiliate:view` |
| `/admin/tag` | Tags | `tags:view` |
| `/admin/appointments` | Appointments admin | `appointments:view` |
| `/admin/leads` | CRM leads | `leads:view` |
| `/admin/kyc` | KYC review | `kyc:view` |
| `/admin/permissions` | Permission profiles | `permissions:view` |
| `/admin/support` | Admin support inbox | `support:view` |
| `/admin/call-user` | Click2call | `call:view` |
| `/admin/voiso` | Voiso embedded panel | `call:view` |
| `/admin/system` | System stats | `system:view` |
| `/admin/settings` | Email, data providers, Voiso | `settings:view` |
| `/admin/reports` | Reports UI | `reports:view` (**no dedicated backend routes found**) |
| `/admin/profile` | Admin profile | (authenticated admin) |

**Access:** `AdminGuard` — roles `admin`, `super_admin`, `manager`, `agent`.

### Auth pages (public)

- `/login`, `/register`, `/impersonate`

---

## 7. Trading Terminal

### Order types (API / engine)

- **Supported in API:** **`MARKET`**, **`LIMIT`** only (`PlaceOrderRequest` in `orders.rs`; `contracts::OrderType`: Market, Limit).
- **SL/TP:** Passed as `sl` / `tp` on order (stored in `orders.stop_price` for SL); position-level SL/TP updates via **`PUT /v1/users/:user_id/positions/:position_id/sltp`**.
- **Time in force:** `GTC`, `IOC`, `FOK` (default GTC).
- **Schema enums** include `stop`, `stop_limit` but **not exposed** on current place-order path.

### Order creation flow

1. **Frontend** → **POST `/api/orders`** or **`/v1/orders`** (alias) with JWT.
2. **`place_order`** (`orders.rs`): validate type/side/size; check `users.trading_access`; **`compute_order_margin_details`** + `risk::effective_leverage`; min margin **$10** (`MIN_REQUIRED_MARGIN_USD`); idempotency via Redis `Keys::idempotency`; compare **free margin**.
3. **INSERT** into **`orders`** (status `pending`).
4. Publish **`VersionedMessage`** type `cmd.order.place` → NATS subject **`cmd.order.place`** (`apps/order-engine/src/subjects.rs`).
5. **order-engine** `OrderHandler` validates, Lua scripts in Redis, fills on **`ticks.{symbol}`** or **`ticks.{symbol}.{group_id}`**.
6. Events: `event.order.filled`, **`evt.order.updated`** → auth-service **`OrderEventHandler`** syncs DB.
7. Positions: **`evt.position.updated`**, **`event.position.closed`** → **`PositionEventHandler`** + account summary refresh.

### Prices / quotes

- **data-provider** ingests Binance + MMDPS → Redis `tick:{symbol}`, NATS `ticks.*`.
- **Per-group markup:** Redis `price:groups`, `symbol:markup:*` (bootstrapped by `AdminMarkupService`, 60s sync loop in `lib.rs`).
- **Logged-in terminal:** **ws-gateway** `/ws` with group-aware ticks (aligned with execution).
- **Charts:** HTTP **`/dp/feed/history`** (MMDPS) via Vite proxy; Binance for crypto-style symbols (`VITE_MMDPS_SYMBOLS`, `MMDPS_AUTO_ROUTE`).
- **Snapshot fallback:** **GET `/v1/terminal/prices`** (`terminal_prices.rs`).

### Positions & P&L

- **Runtime state:** Redis (`pos:{user_id}`, `pos:by_id:{id}`, `pos:open:{symbol}`, `pos:summary:{user_id}`).
- **Mark P&L / equity:** Updated on price ticks via **`PriceTickSummaryHandler`**; cached account summary published on channel **`account:summary:{user_id}`**.
- **DB columns:** `positions.pnl`, `pnl_percent`, `mark_price` (schema.sql).
- **Formula drivers:** contract size, side, entry vs mark, leverage tiers — implemented in order-engine Lua + `crates/risk`.

### Margin / leverage

- **Tiered leverage:** `leverage_profile_tiers` by notional; **`effective_leverage()`** in `crates/risk/src/effective_leverage.rs`.
- **Resolution order:** `group_symbols.leverage_profile_id` → `user_groups.default_leverage_profile_id` → `leverage_profiles.is_default`.
- **User clamps:** `users` min/max leverage fields; group caps.
- **Account types / margin calculation type:** per-user fields affect margin math in `place_order`.
- **Stop-out:** `register_stop_out_nats` in deposits — closes positions when margin level breaches group threshold.

### Order lifecycle states

**Contracts / engine:** `PENDING`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `REJECTED`

**DB enum (`order_status`):** pending, filled, cancelled, rejected, partially_filled

Cancel: **POST `/api/orders/:order_id/cancel`** → NATS **`cmd.order.cancel`**

---

## 8. API Endpoints

**Base:** `http://127.0.0.1:3000` (auth-service). **Auth:** Bearer JWT unless noted. **Permission:** manager needs grant; `admin`/`super_admin` bypass (unless noted).

### Health

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| GET | `/health` | Liveness | Public |

### Auth (`/api/auth`)

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| POST | `/register` | Register trader | Public |
| POST | `/login` | Login | Public |
| POST | `/refresh` | Refresh access token | Public |
| POST | `/password-reset/request` | Request OTP | Public |
| POST | `/password-reset/verify` | Verify OTP | Public |
| POST | `/password-reset/confirm` | Set new password | Public |
| POST | `/logout` | Revoke session | JWT |
| GET | `/me` | Current user | JWT |
| PATCH | `/me` | Update name | JWT |
| GET | `/me/referrals` | Referral tree | JWT |
| GET | `/me/commissions` | Affiliate commissions | JWT |
| GET | `/me/symbol-leverage` | Leverage tiers for symbol | JWT |
| GET | `/users` | List users (paginated, scoped) | JWT + `users:view` / admin scope |

### Orders (`/api/orders`, `/v1/orders`)

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| GET | `/` | List orders | JWT (admin list needs `trading:view`) |
| POST | `/` | Place order | JWT trader / `trading:place_orders` |
| POST | `/estimate` | Margin estimate | JWT |
| POST | `/sync-pending` | Sync pending orders | JWT |
| POST | `/:order_id/cancel` | Cancel order | JWT |

### Positions & account (`/v1/users`, `/api/account`, `/api/wallet`)

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| GET | `/v1/users/:user_id/positions` | Open positions | JWT (own or admin) |
| POST | `/v1/users/:user_id/positions/:position_id/close` | Close position | JWT |
| PUT | `/v1/users/:user_id/positions/:position_id/sltp` | Update SL/TP | JWT |
| GET | `/api/wallet/balance` | Wallet balance | JWT |
| GET | `/api/account/summary` | Account summary | JWT |
| GET | `/api/account/deposits` | My deposits | JWT |

### Deposits & withdrawals

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| POST | `/api/deposits/request` | User deposit request | JWT |
| POST | `/api/deposits/direct` | Direct deposit | JWT |
| GET | `/api/deposits/` | List (context-dependent) | JWT |
| POST | `/api/deposits/:id/approve` | Approve | `deposits:approve` |
| POST | `/api/deposits/:id/reject` | Reject | `deposits:reject` |
| POST | `/api/withdrawals/request` | Withdrawal request | JWT |
| GET | `/api/admin/finance/overview` | Finance dashboard | `finance:view` |
| GET | `/api/admin/finance/transactions` | All transactions | `finance:view` |
| POST | `/api/admin/finance/transactions/:id/approve` | Approve txn | `deposits:approve` |
| POST | `/api/admin/finance/transactions/:id/reject` | Reject txn | `deposits:reject` |
| GET | `/api/admin/finance/wallets` | List wallets | `finance:view` |

### Admin users (`/api/admin/users`)

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| POST | `/` | Create user | `users:create` |
| POST | `/account-summaries` | Batch summaries | `users:view` |
| GET | `/:id/account-summary` | Single summary | `users:view` |
| PUT | `/:id/profile` | Edit profile | `users:edit` |
| PUT | `/:id/group` | Change group | `users:edit_group` |
| PUT | `/:id/account-type` | Account type | `users:edit_account_type` |
| PUT | `/:id/margin-calculation-type` | Margin type | `users:edit_margin` |
| PUT | `/:id/trading-access` | Trading access | `users:edit_trading_access` |
| PUT | `/:id/permission-profile` | Assign profile | `users:edit` |
| PUT | `/:id/role` | Change role | admin |
| POST | `/:id/impersonate` | Impersonate | `users:view` |
| POST | `/:id/notify` | Push notification | `users:view` |
| GET/POST | `/api/admin/user-notes/:user_id` | User notes | `users:view` |

### Admin trading

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET/POST | `/api/admin/orders` | List/create orders | `trading:view` / `trading:create_order` |
| POST | `/api/admin/orders/:id/cancel` | Cancel | `trading:cancel_order` |
| POST | `/api/admin/orders/:id/force` | Force cancel | `trading:cancel_order` |
| GET | `/api/admin/positions` | List positions | `trading:view` |
| POST | `/api/admin/positions/:id/close` | Close | `trading:close_position` |
| POST | `/api/admin/positions/:id/modify-sltp` | SL/TP | `trading:view` |
| POST | `/api/admin/positions/:id/liquidate` | Liquidate | `trading:liquidate` |
| POST | `/api/admin/positions/:id/reopen` | Reopen | admin trading |
| POST | `/api/admin/positions/:id/update-params` | Update params | admin trading |

### Symbols & config

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/api/symbols` | Public symbol list | JWT optional |
| GET/POST | `/api/admin/symbols` | CRUD | `symbols:view/create` |
| POST | `/api/admin/symbols/sync-mmdps` | Sync from MMDPS | `symbols:edit` |
| CRUD | `/api/admin/groups` | Groups | `groups:*` |
| CRUD | `/api/admin/leverage-profiles` | Leverage | `leverage_profiles:*` |
| CRUD | `/api/admin/markup` | Markup profiles | `markup:*` |
| CRUD | `/api/admin/swap/rules` | Swap rules | `swap:*` |
| CRUD | `/api/admin/tags` | Tags | `tags:*` |
| CRUD | `/api/admin/managers` | Managers | `managers:*` |
| CRUD | `/api/admin/permission-profiles` | Profiles | `permissions:*` |
| GET | `/api/admin/permission-profiles/definitions` | All permission defs | `permissions:view` |

### KYC, leads, appointments

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/user/kyc/*` | User KYC upload/submit |
| GET | `/api/admin/kyc` | List submissions (`kyc:view`) |
| POST | `/api/admin/kyc/:id/approve\|reject` | Review (`kyc:approve`, profile-only) |
| CRUD | `/api/leads` | Leads CRM (`leads:*`) |
| GET/POST | `/api/appointments` | User appointments |
| CRUD | `/api/admin/appointments` | Admin appointments (`appointments:*`) |

### Support & comms

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/v1/users/me/chat` | User support chat |
| GET/POST | `/api/admin/chat/conversations` | Admin support (`support:*`) |
| GET | `/api/admin/call-records` | Call history (`call:view`) |
| GET/PUT | `/api/admin/voiso` | Voiso config |
| GET/PUT | `/api/admin/settings/*` | Email, templates, data providers (`settings:*`) |

### Misc admin

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/audit` | Audit log (`risk:view`) |
| GET | `/api/admin/user-events` | User events (`user_events:view`) |
| GET/POST | `/api/admin/bulk/*` | Bulk user ops (`users:bulk_create`) |
| GET | `/api/promotions/slides` | Public slides |
| CRUD | `/api/admin/promotions/slides` | Manage slides (`promotions:*`) |
| GET/PUT | `/api/user/terminal-preferences` | Terminal prefs |
| GET | `/api/admin/system` | System stats (`system:view`) |
| CRUD | `/api/admin/affiliate/*` | Affiliate (`affiliate:*`) |
| GET | `/v1/terminal/prices` | Terminal price snapshot |
| GET | `/api/notifications` | User notifications |

### WebSocket (ws-gateway)

| Path | Purpose |
|------|---------|
| **WS `/ws`** | Auth, subscribe symbols/channels (ticks, balances, deposits, support) |

### data-provider HTTP (port 9004, proxied `/dp`)

| GET | `/health`, `/prices`, `/feed/history`, `/feed/status`, `/metrics` |

### core-api (port 3004, legacy)

Mirrors some `/v1/orders`, deposits; **`/api/auth/*` returns "not available"** — use auth-service in production.

---

## 9. Key Business Logic

### Order execution (not a matching engine)

- **Location:** `apps/order-engine/src/engine/` — `OrderHandler`, `TickHandler`, `CancelHandler`, `PositionHandler`, `SltpHandler`; **Lua** in `apps/order-engine/lua/`.
- **Model:** Broker **dealer desk** — orders fill against **latest tick** (bid/ask with group markup), not peer matching.
- **Validation:** `apps/order-engine/src/engine/validator.rs` + auth-service pre-checks (margin, trading_access).

### Risk management

- **Leverage tiers:** `crates/risk::effective_leverage`
- **Liquidation / margin call:** `crates/risk/liquidation.rs`, `margin_events` table, stop-out listener in `deposits.rs`
- **Group limits:** `user_groups`, `risk_limits`, per-user caps (`max_position_size`, `max_daily_loss`)
- **Trading access:** `users.trading_access` — blocks new orders or allows close-only

### Commission / spread / swap

- **Spread:** `price_stream_profiles` bid/ask markup applied in feed path (Redis-backed).
- **Swap:** `swap_rules` — `calc_mode` (daily/hourly/funding_8h), long/short rates; charged on schedule (admin-configured).
- **Affiliate:** `affiliate_commission_layers`, commissions on referred user activity; deposit flow can credit referrer in `deposits.rs`.

### Deposit / withdrawal flow

1. User **POST `/api/deposits/request`** → `deposit_requests` status `PENDING`.
2. Admin **approve** → wallet/`transactions` updated, **`publish_wallet_balance_updated`**, NATS/Redis notify UI.
3. **Withdrawals:** **POST `/api/withdrawals/request`** → approval via finance routes.
4. **Manual adjustment:** `finance:manual_adjustment` permission.

### Background workers / listeners (auth-service `lib.rs` tokio tasks)

| Worker | Trigger |
|--------|---------|
| `OrderEventHandler` | NATS `evt.order.updated` |
| `PositionEventHandler` | NATS `evt.position.updated` |
| Position closed handler | NATS `event.position.closed` → account summary + SL/TP/liquidation notifications |
| `CallRecordHandler` | NATS `admin_call.events` |
| Redis `wallet:balance:request` | On-demand balance publish |
| `PriceTickSummaryHandler` | Redis `price:ticks` |
| `account_summary_cache_warmup` | Startup warm all users |
| Markup `price:groups` sync | Every **60s** |
| order-engine main loop | NATS ticks + `cmd.order.*` |

**No traditional cron** — interval tasks are `tokio::time::interval` in-process.

---

## 10. Configuration

### Environment variables (names only)

**Shared / auth-service**

- `DATABASE_URL`, `REDIS_URL`, `NATS_URL`, `PORT`, `CORS_ORIGINS`
- `JWT_SECRET`, `JWT_ISSUER`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`
- `KYC_UPLOAD_DIR`, `SYSTEM_STATS_FILE`
- `MMDPS_API_KEY`, `MMDPS_SYMBOLS_URL`, `MMDPS_WS_BASE`, `MMDPS_HISTORY_BASE`
- `VOISO_API_KEY`, `VOISO_CLICK2CALL_URL`

**Frontend (Vite)**

- `VITE_API_URL`, `VITE_DATA_PROVIDER_WS_URL`, `VITE_DATA_PROVIDER_HTTP_URL`, `VITE_DATA_PROVIDER_HTTP_PATH`, `VITE_VOISO_PANEL_URL`, `VITE_MMDPS_SYMBOLS`

**data-provider**

- `FEED_PROVIDER`, `BINANCE_WS_URL`, `INITIAL_SYMBOLS`, `WS_PORT`, `HTTP_PORT`, `ADMIN_SECRET_KEY`, `SERVER_REGION`, `MAX_CONNECTIONS`
- `SYMBOLS_DATABASE_URL`, `SYMBOLS_CATALOG_REFRESH_SECS`, `CATALOG_MMDPS_MAX_SYMBOLS`
- `MMDPS_AUTO_ROUTE`, `MMDPS_SYMBOLS`, `FEED_FRESHNESS_*`, `FEED_WATCHDOG_*`

**ws-gateway**

- `WS_PORT`, `HTTP_PORT`, `BIND_ADDRESS`, `MAX_CONNECTIONS`, `HEARTBEAT_INTERVAL_SECS`, `CONNECTION_TIMEOUT_SECS`
- `REDIS_POOL_SIZE`, `MAX_SYMBOLS_PER_CLIENT`, `MAX_MESSAGE_SIZE_BYTES`, `MAX_REQUESTS_PER_SECOND`, `RATE_LIMIT_BURST`
- `METRICS_ENABLED`, `METRICS_PORT`

**order-engine**

- `MAX_PENDING_ORDERS_PER_SYMBOL`, `RUST_LOG`, `LOG_TO_FILE`

**Deploy**

- `POSTGRES_PASSWORD`, `CORS_ORIGINS`

### Feature flags / settings tables

- No global feature-flag service — behavior driven by **DB config tables** (`platform_*`, group/user flags) and **env** (`MMDPS_AUTO_ROUTE`, etc.).
- **`permission_profiles`** effectively feature-gate admin UI/actions.

---

## 11. Known Gotchas

1. **Two API servers:** Production uses **`auth-service`**; **`core-api`** auth routes are stubs — do not point frontend at core-api for login.
2. **Dual migration paths:** `infra/migrations/` (deploy) vs `backend/auth-service/migrations/` — keep both in sync for new environments.
3. **`database/schema.sql` vs runtime:** e.g. `leverage_tiers` vs `leverage_profile_tiers`; `symbols.code` vs early `symbols.symbol` in `001_initial_schema.sql`.
4. **Order types in DB enum vs API:** Schema allows `stop`/`stop_limit`; **API only MARKET/LIMIT**.
5. **NATS required:** auth-service **fails to start** without NATS (`lib.rs` returns error if connect fails).
6. **JWT_SECRET:** Dev fallback in `get_jwt_secret()` if unset — must set in production (must match ws-gateway).
7. **Manager scoping:** Admins with a **`managers` row** are scoped even if `role=admin` — only admin **without** manager row sees all groups (`scoped_access.rs`).
8. **`permission_check`:** `role=admin` bypasses grants; **`kyc:approve`** uses profile-only check.
9. **Funded programs & bonus/reports:** Admin/user funded-program pages use **mock/TODO** — no backend routes in `auth-service/src/routes`.
10. **List users endpoint:** Admin user table uses **GET `/api/auth/users`**, not `/api/admin/users` (admin router is mutations only).
11. **Price markup Redis:** Must bootstrap/sync (`bootstrap_price_groups_redis`, 60s sync) or ticks may lack group markup after Redis flush.
12. **No polling rule:** Use WebSocket subscriptions (`wsClient.ts`); account summary refreshes on events/ticks.
13. **Impersonation:** Separate `/impersonate` route; audit via `user_events` where instrumented.
14. **Duplicate data-provider apps:** `backend/data-provider` vs `apps/data-provider` — confirm which binary deploy compose builds.

---

## 12. Glossary

| Term | Meaning in this codebase |
|------|---------------------------|
| **NEWPT / newpt** | Project/database name (`newpt` Postgres DB) |
| **auth-service** | Main Rust HTTP API (despite name, handles trading + admin) |
| **order-engine** | Async worker executing orders against ticks |
| **ws-gateway** | WebSocket server for UI real-time data |
| **MMDPS** | Third-party forex/CFD price + history API |
| **Group (`user_groups`)** | Tenant bucket: default leverage, markup, swap, signup slug |
| **Price stream profile** | Markup configuration applied to raw feed (bid/ask adjustment) |
| **Leverage profile** | Tiered max leverage by notional (`leverage_profile_tiers`) |
| **Manager** | Staff user with `managers` row + `permission_profile_id` |
| **Permission profile** | Named set of `permission_key` grants (sub-admin RBAC) |
| **Trading access** | `full` / `close_only` / `disabled` on `users` |
| **Account summary** | Redis `pos:summary:{user_id}` — balance, equity, margin, free margin, unrealized PnL |
| **PlaceOrderCommand** | NATS payload (`contracts`) for `cmd.order.place` |
| **VersionedMessage** | `{ v, type, payload }` envelope for NATS commands/events |
| **Scoped access** | Manager visibility limited by tag→group mapping |
| **Terminal** | Full-screen trading UI at `/` (`TerminalPage`) |
| **User panel** | Account management routes under `/user/*` |
| **Full Access** | Protected permission profile name (cannot edit/delete) |
| **Stop-out** | Auto-close positions when margin level falls below threshold |
| **Voiso** | Telephony/omnichannel integration for admin calls |
| **COALESCE leverage resolution** | `group_symbols` override → group default → platform `is_default` profile |

---

## Related docs

- [USER_EVENTS_HISTORY_PLAN.md](./USER_EVENTS_HISTORY_PLAN.md)
- [USER_EVENTS_TRADING_PROPOSAL.md](./USER_EVENTS_TRADING_PROPOSAL.md)
- Broker scoping: see `docs/SOLUTION_BROKER_ISOLATION_BY_TAGS.md` (referenced from `scoped_access.rs`)

---

*Last generated from codebase scan. Update this file when architecture or routes change materially.*
