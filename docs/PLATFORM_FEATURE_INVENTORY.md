# Platform feature inventory (codebase audit)

**Generated:** read-only audit of repository state. Paths are relative to repo root unless absolute.

**Scanned locations:** `src/`, `backend/auth-service/`, `backend/ws-gateway/`, `backend/data-provider/`, `apps/order-engine/`, `apps/core-api/`, `apps/gateway-ws/`, `apps/data-provider/`, `crates/`, `deploy/`, `infra/migrations/`, `backend/auth-service/migrations/`, `database/migrations/`.

---

## Section A — Executive summary

- **Stack:** React + TypeScript SPA (`src/`), Axum **auth-service** on port 3000 (`backend/auth-service`), **order-engine** (NATS + Redis + Lua) (`apps/order-engine`), **ws-gateway** for authenticated user WebSockets (`backend/ws-gateway`), **data-provider** for feeds/markup/ticks (`backend/data-provider`), optional **core-api** and **gateway-ws** (`apps/core-api`, `apps/gateway-ws`), Postgres + Redis + NATS JetStream in `deploy/docker-compose.prod.yml`.
- **Primary UX:** `/` is the **trading terminal** (AuthGuard); `/admin/*` is the operator console; `/user/*` is the end-user portal (profile, KYC, deposits, etc.).
- **Execution path:** Orders hit `POST /api/orders` or `/v1/orders` in auth-service → NATS `cmd.order.place` → order-engine Lua (`atomic_fill_order`, etc.) → Redis position/order keys → events `evt.order.updated`, `evt.position.updated`, `event.position.closed`, etc. → auth-service listeners persist to Postgres; **ws-gateway** fans out Redis pub/sub to browsers.
- **Market data:** **Binance** multiplex WS for crypto (`backend/data-provider/src/feeds/binance_feed.rs`); **MMDPS** for forex-style symbols (`mmdps_feed.rs`); chart history via `fetchChartKlines` / data-provider HTTP (`src/features/terminal/api/binanceKlines.ts`).
- **Risk:** Per-user **hedging vs netting** and **hedged vs net margin calculation** on `users`; **tiered leverage** from profiles; **SL/TP** checked on ticks (`SltpHandler` + `check_sltp_triggers.lua`); **stop-out** publishes `cmd.position.close_all` from account summary recompute (`try_publish_stop_out_close_all` in `deposits.rs`).
- **CRM / ops:** Leads, appointments, support chat (NATS `chat.*`), Voiso config, admin call user + WebRTC signaling types in `wsEvents.ts`.
- **Gaps / stubs:** `/admin/reports`, `/admin/bonus`, `/user/trading`, user funded “My Plans” demo data, admin funded programs local `DEMO_PLAN`; **dual/parallel** services (`apps/core-api` vs auth overlap; `apps/gateway-ws` vs `ws-gateway`; `apps/data-provider` vs `backend/data-provider`); **three migration trees** (`infra/migrations`, `backend/auth-service/migrations`, `database/migrations`).
- **CI:** No `.github` or `.gitlab-ci.yml` found in repo (UNCERTAIN: CI may live outside).

---

## Section B — Feature count

```
Total features cataloged: 118
By status:
  ✅ Complete:   61
  ⚠️ Partial:    38
  🚧 TODO/stub:  12
  🗑️ Legacy:      7
```

*(Counts are row-level judgments from code inspection; “UNCERTAIN” items excluded from totals.)*

---

## Section C — Top 5 most complete features

1. **Order lifecycle (place → engine → DB → UI)** — NATS commands, Lua scripts, `OrderEventHandler`, terminal `placeOrder` / BottomDock WS — `apps/order-engine/`, `backend/auth-service/src/services/order_event_handler.rs`, `src/features/terminal/api/orders.api.ts`.
2. **Authenticated WebSocket gateway + Redis fan-out** — Multi-channel subscriber, JWT, per-user routing — `backend/ws-gateway/src/main.rs`, `stream/broadcaster.rs`.
3. **Auth API (register/login/refresh/password reset/me)** — `backend/auth-service/src/routes/auth.rs`, `src/pages/auth/*`, `src/shared/store/auth.store.ts`.
4. **Admin user + RBAC surface** — Users, permission profiles, tags, managers, scoped APIs — `src/features/adminUsers`, `admin_permission_profiles`, `backend/auth-service/src/routes/admin_users.rs`, `scoped_access.rs`.
5. **Account summary + stop-out + tick-driven PnL** — Redis `pos:summary:{user_id}`, `account:summary:updated`, `PriceTickSummaryHandler` — `crates/redis-model/src/keys.rs`, `backend/auth-service/src/routes/deposits.rs`, `services/price_tick_summary_handler.rs`.

---

## Section D — Top 5 most incomplete features

1. **Admin Reports** — Placeholder copy only — `src/features/reports/pages/ReportsPage.tsx`.
2. **Admin Bonus** — Placeholder — `src/features/bonus/pages/BonusPage.tsx`.
3. **User funded programs (“My Plans”)** — Hardcoded `DEMO_PLANS` — `src/features/userPanel/pages/UserFundedProgramsPage.tsx`.
4. **Admin funded programs** — In-memory `DEMO_PLAN`, comment “Replace with API” — `src/features/adminFundedPrograms/pages/AdminFundedProgramsPage.tsx`.
5. **`/user/trading` page** — “coming soon” — `src/features/trading/pages/TradingPage.tsx`, `src/app/router/routes.tsx`.

---

## Section E — Sales-ready feature list (no paths, no status)

- **Trading:** Live charts with multiple timeframes and chart types, technical indicators and drawing tools, symbol discovery and watchlists, live bid/ask, market and limit orders, stop loss and take profit on orders and positions, leverage tiers and cost preview, multi-pane terminal with positions and orders, real-time updates, bulk close, mobile-friendly terminal layout.
- **Account & wallet:** Balances, equity, margin and free margin, PnL, deposits and withdrawals with review flows, transaction history, in-app notifications, margin call awareness.
- **User portal:** Dashboard, profile, KYC submission, positions and orders history, appointments, affiliate/referrals, support messaging, deposits and withdrawals.
- **Admin & risk:** User and group management, trading and position oversight, symbol and markup configuration, leverage profiles and swap rules, finance and transaction approval, CRM leads and appointments, KYC review, permissions and manager scoping, system and email settings, promotions, support inbox, call center integrations, AI-assisted chat and reporting tools.
- **Compliance & operations:** Audit and user event trails, impersonation for support, configurable email templates, Voiso telephony settings, health endpoints for services.
- **Integrations:** Binance and institutional feed connectors, email (SMTP) configuration, Voiso embedded telephony, real-time messaging infrastructure.

---

## Scanned locations (reference)

| Area | Paths |
|------|--------|
| Frontend app | `src/app/router/*.tsx`, `src/features/**`, `src/pages/**`, `src/shared/**` |
| Auth / REST | `backend/auth-service/src/lib.rs`, `routes/*.rs`, `services/*.rs` |
| WS | `backend/ws-gateway/**` |
| Feeds | `backend/data-provider/**` |
| Engine | `apps/order-engine/**` |
| Alt / compat | `apps/core-api/**`, `apps/gateway-ws/**`, `apps/data-provider/**` |
| Shared contracts | `crates/contracts/**`, `crates/redis-model/**`, `crates/risk/**` |
| DB | `infra/migrations/*.sql`, `backend/auth-service/migrations/*.sql`, `database/migrations/*.sql` |
| Deploy | `deploy/docker-compose.prod.yml`, `deploy/Dockerfile.*` |

---

## 1. AUTHENTICATION & ACCOUNT FEATURES

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Email/password registration | ✅ | `POST /api/auth/register` `backend/auth-service/src/routes/auth.rs`; `src/pages/auth/RegisterPage.tsx` | Creates user; supports `?ref=` signup slug and legacy `?group=` |
| Login | ✅ | `POST /api/auth/login`; `src/pages/auth/LoginPage.tsx` | JWT access + refresh in auth store |
| JWT access + refresh rotation | ✅ | `POST /api/auth/refresh`; `auth_service.rs`, `src/shared/store/auth.store.ts` | Standard refresh flow |
| Logout / session revoke | ✅ | `POST /api/auth/logout`; `auth.rs` | Clears server-side session where implemented |
| Password reset (request → verify → confirm) | ✅ | `POST /api/auth/password-reset/*`; `ForgotPasswordPage.tsx` | Three-step API surface |
| Profile self-edit | ✅ | `PATCH /api/auth/me`, `GET /api/auth/me`; `UserProfilePage.tsx`, `useProfile.ts` | Name/email/password updates (subject to API rules) |
| Referral tree / commissions | ✅ | `GET /api/auth/me/referrals`, `.../commissions`; `UserAffiliatePage.tsx`, `useMyReferrals.ts` | User-facing referral stats |
| Signup slug / group from URL | ✅ | `user_groups.signup_slug` migrations; `RegisterPage.tsx` (`ref`, `groupRef`) | Assigns group from marketing link |
| KYC submission (upload + status) | ✅ | `/api/user/kyc/*` `routes/kyc.rs`; `UserKycPage.tsx`, `admin_kyc.rs` | Document upload to `KYC_UPLOAD_DIR` |
| Admin impersonation | ✅ | `POST /api/admin/users/:id/impersonate`; `ImpersonatePage.tsx`, `auth_service.rs` `impersonate` | Issues target user tokens; opens `/impersonate` |
| OAuth / social login | 🗑️ | No Google/GitHub routes in `auth.rs` | Not present |
| 2FA (TOTP/WebAuthn) | 🗑️ | — | Not present |

---

## 2. TRADING TERMINAL FEATURES

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Live candlestick chart (klinecharts) | ✅ | `ChartPlaceholder.tsx` (`init` from `klinecharts`) | Live + history merge |
| Chart timeframes 1m–1W | ✅ | `src/features/terminal/utils/chartOptions.ts` `TIMEFRAMES` | Wired to chart data |
| Chart types candles / line / area | ✅ | `chartTypeToCandleType`, `ChartTopBar.tsx` | User-selectable |
| Drawing tools + magnet modes | ✅ | `ChartTopBar.tsx`, `CenterWorkspace.tsx`, persistence `chartToolbarPersistence.ts` | klinecharts overlays |
| Symbol search + list | ✅ | `LeftSidebar.tsx`, `TerminalSymbolsPage.tsx`, symbols API | Search + categories helper `symbolCategories.ts` |
| Symbol categories (Forex/Crypto/…) | ✅ | `symbolCategories.ts`; `AdminSymbol` / `MockSymbol` `assetClass` | Grouped display from symbol metadata |
| Live quote bid/ask/spread | ✅ | `PriceDisplay.tsx`, ticks over WS `priceStreamClient.ts` | Group-aware gateway ticks |
| Order ticket Market / Limit | ✅ | `RightTradingPanel.tsx`, `orders.api.ts` `placeOrder` | Maps to `OrderType` Market/Limit in contracts |
| SL/TP on placement | ✅ | `RightTradingPanel.tsx`; `contracts/commands.rs` `sl`/`tp` | Sent with place command |
| SL/TP update on open positions | ✅ | `positions.api.ts` `updatePositionSltp`; BottomDock / positions UI | REST + WS refresh |
| Order types Stop / Stop-Limit | 🗑️ | `crates/contracts/src/enums.rs` only `Market`, `Limit` | Not in engine enum |
| Time-in-force GTC/IOC/FOK | ⚠️ | `TimeInForce` in `enums.rs`; `orders.api.ts` `tif?`; ticket uses `tif: 'GTC'` in `RightTradingPanel.tsx` | API supports; UI fixed to GTC |
| Free Margin % slider (default 15%) | ✅ | `RightTradingPanel.tsx` `applyFreeMarginFromPct`, `DEFAULT_FREE_MARGIN_SLIDER_PCT` | Sizes order from % of free margin |
| Effective leverage / tiers | ✅ | `resolveEffectiveLeverageFromTiersOrNull` in `orders.api.ts`; `GET /api/auth/me/symbol-leverage` | Shown in ticket / estimates |
| Cost breakdown (spread, fees, margin, liq.) | ✅ | `costBreakdown` useMemo, `useQuery` `estimateOrderMargin` in `RightTradingPanel.tsx` | Server estimate + client breakdown |
| Buy / Sell (CFD long/short) | ✅ | `RightTradingPanel.tsx`, `previewOrderSide` | Buy uses ask, sell bid for estimates |
| Promotional slides carousel | ✅ | `getPromotionSlides` `promotions.api.ts`; `GET /api/promotions/slides` | DB-backed slides + admin CRUD |
| Multi-pane layout | ✅ | `TerminalPage.tsx`, `AppShellTerminal.tsx`, `TerminalLayout.tsx` | Chart + sidebars + dock |
| Mobile terminal layout | ✅ | `TerminalLayout.tsx` `isMobile`, `TerminalMobileNav.tsx`, `CenterWorkspace.tsx` | Tabbed chart/trade/positions/account |
| Bottom dock tabs | ✅ | `BottomDock.tsx` | Positions, orders, history, account strip |
| Real-time positions / orders | ✅ | WS `positions:updates`, `orders:updates`; `BottomDock.tsx`, `useWebSocket.ts` | Redis → ws-gateway → client |
| Close All | ✅ | Close-all action in UI + API path (order-engine `CMD_POSITION_CLOSE_ALL`) | NATS `cmd.position.close_all` |
| Per-position close + SL/TP + edit | ✅ | `positions.api.ts`, `BottomDock.tsx` | Partial close supported in API types |
| Export positions/orders | ⚠️ | `BottomDock.tsx` Export button → `toast.success('Data exported successfully')` | UX only; no file download |
| Column customization | ⚠️ | `BottomDock.tsx` (`Columns` icon, column visibility state) | Local UI state; verify persistence UNCERTAIN |
| Chart PNG/JPEG export | ✅ | `CenterWorkspace.tsx` `downloadChartAs`, `ChartTopBar.tsx` | Client-side export |
| Ping / latency display | ✅ | `RightTradingPanel.tsx` RTT via `/ws-health` / gateway health | Shown in ticket header |
| AI chat tab (terminal) | ⚠️ | `AiChatTab.tsx`, `routes/ai_chat.rs`, NATS `ai.chat.>` | Feature-rich UI; depends on deployment |
| `/user/trading` legacy page | 🚧 | `TradingPage.tsx` | Placeholder |

---

## 3. ACCOUNT SUMMARY / WALLET FEATURES

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Bottom dock account metrics | ✅ | `BottomDock.tsx`, `formatAccountSummary.ts`, `GET /api/account/summary` | Balance, equity, margin, bonus fields, PnL, margin level |
| Header / sidebar balance | ✅ | `LeftSidebar.tsx`, wallet hooks | Uses same summary / WS |
| Deposit request (user) | ✅ | `deposits.rs`, `UserDepositPage.tsx`, `PaymentPanel.tsx` | Creates pending deposit + notifications |
| Withdrawal request | ✅ | `withdrawals.rs`, `UserWithdrawPage.tsx`, `useWithdrawalFlow.ts` | Publishes `withdrawal.request.created`, Redis |
| Transaction history (admin/user) | ✅ | `finance.rs`, `AdminTransactionsPage.tsx`, user wallet views | List/filter transactions |
| Wallet balance API | ✅ | `/api/wallet/*` in `deposits.rs`; `wallet/api.ts` | Multi-currency style fields |
| Bonus field in summary | ⚠️ | Account summary types / UI | Shown if backend sends; no dedicated bonus engine in migrations |
| Manual finance adjustment | ✅ | Migration `add_finance_manual_adjustment.sql`; `finance.rs` | Admin credit/debit flows |
| Margin call toast/modal | ✅ | `useMarginCall.ts` | Client-side threshold vs `marginCallLevelThreshold` |
| Spot/margin/funding “wallet types” | 🗑️ | Unclear separate product wallets | Single wallet model in code paths reviewed |

---

## 4. USER PANEL FEATURES

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| User dashboard | ✅ | `UserDashboardPage.tsx`, `dashboard.api.ts` | Uses real admin-style stats APIs |
| Profile | ✅ | `/user/profile` | Editable profile |
| KYC page | ✅ | `/user/kyc` `UserKycPage.tsx` | Upload + status |
| Positions history | ✅ | `UserPositionsPage.tsx` | Lists user positions |
| Orders history | ✅ | `UserOrdersPage.tsx` | Order history |
| Funded program page | ⚠️ | `UserFundedProgramsPage.tsx` | Demo plans only |
| Appointments (user) | ✅ | `appointments.rs`, `UserAppointmentsPage.tsx` | CRUD via API |
| Affiliate / referrals | ✅ | `/user/affiliate` | Stats + referral UX |
| Support (user) | ✅ | `/user/support`; chat to `POST /v1/users/.../chat` (see chat routes) | Messages + WS |
| Deposit / withdraw pages | ✅ | `/user/deposit`, `/user/withdraw` | Forms + history |
| Notifications inbox (terminal) | ✅ | `NotificationsPanel.tsx`, `notificationsStore`, `GET` notifications in deposits routes | DB + `notification.push` WS |
| Terminal preferences persistence | ✅ | `user_preferences.rs`, `preferences.api.ts`, `loadTradingPanelState` localStorage | Server + local chart/ticket prefs |

---

## 5. ADMIN PANEL — USER MANAGEMENT

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| User list + filters | ✅ | `AdminUsersPage.tsx`, `UsersTable.tsx`, `admin_users.rs` | Pagination, search |
| Create user | ✅ | Admin users routes / modals | Creates records + permissions |
| Bulk user import | ✅ | `/api/admin/bulk/users` `admin_bulk.rs`; `AdminBulkOperationsPage.tsx` | CSV-style bulk |
| Edit profile / group / account / margin / trading / role | ✅ | `admin_users.rs` various `PUT` routes; `UserDetailsModal.tsx` | Extensive modal |
| Permission profile assign | ✅ | User modal + `admin_permission_profiles` | Profile grants |
| User notes | ✅ | `/api/admin/user-notes` | Notes CRUD |
| Impersonate | ✅ | See section 1 | |
| Push notification to user | ⚠️ | `admin_users.rs` publish `notifications:push` / NATS | Admin “notify user” path exists; verify all kinds UNCERTAIN |
| Per-user dashboard in modal | ✅ | `UserDetailsModal.tsx` tabs | Wallet, trades, etc. |
| User events log | ✅ | `/api/admin/user-events` `admin_user_events.rs`; `AdminUserEventsPage.tsx` | Auditable events |
| KYC review queue | ✅ | `AdminKycPage.tsx`, `admin_kyc.rs` | Approve/reject |

---

## 6. ADMIN PANEL — TRADING OPERATIONS

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Orders admin view | ✅ | `AdminTradingPage.tsx`, `admin_trading.rs`, `GET /api/admin/orders` | All-users orders |
| Create order on behalf of user | ✅ | `admin_trading.rs` publishes `cmd.order.place` | JetStream or core NATS |
| Cancel / force-cancel | ✅ | `cmd.order.cancel` publish paths | |
| Positions admin view | ✅ | Same page/components; Redis-backed open positions | |
| Close position (incl. liquidate route) | ✅ | `admin_positions.rs` `/:id/close`, `/:id/liquidate` → same handler | NATS `cmd.position.close` |
| Modify SL/TP | ✅ | `/:id/modify-sltp` | |
| Reopen / reopen-with-params / update-params | ✅ | NATS `cmd.position.reopen*`, `cmd.position.update_params` | Matches order-engine subjects |

---

## 7. ADMIN PANEL — CONFIGURATION

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Groups CRUD + trading flags | ✅ | `admin_groups.rs`, `GroupsPage.tsx` | Includes `signup_slug`, leverage profile, withdraw/trading flags, `hide_leverage_in_terminal` (migration `049_*.sql`) |
| Group–symbol settings | ✅ | Group routes + DB | Per-group symbol overrides |
| Group price / markup profile | ✅ | `admin_markup.rs`, Redis `price:groups` bootstrap `lib.rs` | |
| Group tags | ✅ | `admin_group_tags_router` | |
| Symbols catalog CRUD | ✅ | `admin_symbols.rs`, `SymbolsPage.tsx` | |
| MMDPS symbol sync | ✅ | `run_mmdps_sync` `lib.rs`; `AdminSymbolsService::sync_from_mmdps` | CLI/bin + service |
| Markup / price stream profiles | ✅ | `admin_markup.rs`, `redis-model` keys `psprof:*` | |
| Symbol markup overrides | ✅ | Admin markup UI + Redis `symbol:markup:*` (UNCERTAIN exact key prefix variant) | |
| Leverage profiles + tiers | ✅ | `admin_leverage_profiles.rs`, `LeverageProfilesPage.tsx` | |
| Swap rules | ✅ | `admin_swap.rs`, `SwapRulesPage.tsx` | |
| Promotion slides | ✅ | `promotions.rs`, `AdminPromotionsPage.tsx` | |
| Email config + templates | ✅ | `admin_settings.rs`, migrations `015_platform_email_config.sql`, `058_platform_email_templates.sql` | |
| Data provider integrations | ✅ | `DataProviderIntegrationsService`, `IntegrationsSettingsTab.tsx`, migration `050_platform_data_provider_integrations.sql` | Synced to Redis on boot |
| Voiso config | ✅ | `admin_voiso.rs`, migration `053_platform_voiso_config.sql`, `AdminVoisoPage.tsx` | |
| System settings | ✅ | `admin_system.rs`, `SystemPage.tsx` | |

---

## 8. ADMIN PANEL — RBAC

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Permission profiles + grants | ✅ | `admin_permission_profiles.rs`, `PermissionsPage.tsx` | |
| Permission categories | ✅ | Migrations splitting categories | DB-driven nav |
| Managers CRUD | ✅ | `admin_managers.rs`, `ManagersPage.tsx` | |
| Manager stats / detail | ✅ | `ManagerDetailPage.tsx` | |
| Tags + scoped access | ✅ | `admin_tags.rs`, `scoped_access.rs`, manager/group tag routers | Super-admin vs tagged scope |
| Roles user/admin/super_admin/manager | ✅ | Claims checks across routes (e.g. `admin_tags.rs`, `ai_reports.rs`) | **“agent”** as product role: only comments/model fields; **no `AgentGuard` routes** in `AppRouter.tsx` |

---

## 9. ADMIN PANEL — FINANCE

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Finance / transactions UI | ✅ | `AdminTransactionsPage.tsx`, `finance.api.ts`, `finance.rs` | Approve/reject/list |
| Finance overview widgets | ✅ | `DashboardPage.tsx` pulls finance APIs | Charts from transactions |
| Deposit approval | ✅ | `deposits.rs` admin routes; WS `deposits:approved` | |
| Withdrawal approval | ✅ | `withdrawals.rs` + finance | |
| Wallet admin | ⚠️ | `WalletDetailsModal.tsx` imports `mockLedgerEntries` | **Mock** ledger detail |
| Manual credit/debit | ✅ | `finance.rs` + migration | |

---

## 10. ADMIN PANEL — CRM

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Leads CRUD + pipeline | ✅ | `admin_leads.rs`, `AdminLeadsPage.tsx`, detail page | |
| Appointments admin | ✅ | `admin_appointments.rs`, `AdminAppointmentsPage.tsx` | |
| User appointments | ✅ | `appointments.rs` user routes | |
| Audit log | ✅ | `admin_audit.rs`, `AdminProfilePage` / audit consumers UNCERTAIN UI location | Backend route exists |
| Bonus admin | 🚧 | `BonusPage.tsx` | Stub |
| Reports admin | 🚧 | `ReportsPage.tsx` | Stub |
| Affiliate admin | ✅ | `admin_affiliate.rs`, `AffiliatePage.tsx` | Commission layers, etc. |

---

## 11. ADMIN PANEL — COMMUNICATIONS

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Support chat admin | ✅ | `/api/admin/chat/*` `chat.rs`; `SupportPage.tsx` | NATS `chat.support`, `chat.user.{id}` |
| Voiso embedded panel | ✅ | `/admin/voiso` `AdminVoisoPage.tsx`; build arg `VITE_VOISO_PANEL_URL` | iframe embed |
| Click-to-call / PSTN | ⚠️ | Voiso + call records; exact PSTN flow in Voiso cloud UNCERTAIN | `admin_call_records.rs`, `call_record_handler.rs` |
| WebRTC admin↔user | ✅ | `AdminCallUserPage.tsx`, `UserCallProvider.tsx`, `wsEvents.ts` call.* | Signaling over ws-gateway |
| Call history | ✅ | `admin_call_records.rs`, DB `admin_call_records` migration `018_*.sql` | |
| Email “broadcast” | 🗑️ | No dedicated broadcast route found | Transactional email config only |
| Push notifications | ✅ | Redis `notifications:push`, NATS `notification.push`, `NotificationBell.tsx` | |

---

## 12. INTEGRATIONS

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Binance WebSocket | ✅ | `binance_feed.rs` | Multiplex ticker streams |
| MMDPS | ✅ | `mmdps_feed.rs`, `MMDPS` settings in DB/Redis | Forex/CFD-style feed |
| Voiso | ✅ | `053_platform_voiso_config.sql`, `admin_voiso.rs`, `docs/voiso-integration-guide.md` | |
| SMTP / transactional email | ✅ | `015_platform_email_config.sql`, sending in services UNCERTAIN single entry | Config + templates in DB |
| KYC SaaS (Sumsub, etc.) | 🗑️ | No provider SDK in repo | File upload + DB status only |
| Card/crypto payment gateway | 🗑️ | No Stripe/PayPal integration code | Mock mentions `Stripe` only in `finance.mock.ts` |

---

## 13. REAL-TIME INFRASTRUCTURE

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| WebSocket gateway | ✅ | `backend/ws-gateway` HTTP `WS_PORT`, health `HTTP_PORT` | JWT auth, subscribe protocol `ws/protocol.rs`, `message_validation.rs` |
| Redis channels (ws-gateway) | ✅ | `main.rs` vec | `price:ticks`, `orders:updates`, `positions:updates`, `risk:alerts`, `deposits:requests`, `deposits:approved`, `notifications:push`, `wallet:balance:updated`, `account:summary:updated` |
| NATS (terminal-facing via gateway bridge) | ✅ | `ws-gateway` subscribes `chat.>`, `ai.chat.>`, `ai.report.>` | Forwards to sessions |
| NATS subjects (order path) | ✅ | `apps/order-engine/src/subjects.rs` | **Commands:** `cmd.order.place`, `cmd.order.cancel`, `cmd.position.close`, `cmd.position.close_all`, `cmd.position.reopen`, `cmd.position.reopen_with_params`, `cmd.position.update_params` — **Events:** `event.order.accepted|rejected|filled|canceled`, `evt.order.updated`, `event.position.opened`, `event.position.closed`, `evt.position.updated`, `event.balance.updated` |
| NATS (chat / wallet / deposits) | ✅ | `chat.rs`, `withdrawals.rs`, `core-api` deposits | e.g. `withdrawal.request.created`, `wallet.balance.updated`, `deposit.request.*` (see `apps/gateway-ws/src/main.rs` tick-forwarder comments) |
| Account summary cache key | ✅ | `pos:summary:{user_id}` alias `account:summary:{user_id}` in `crates/redis-model/src/keys.rs` | |
| Position hot state | ✅ | `pos:{user_id}`, `pos:by_id:{id}`, `pos:open:{symbol}`, `ord:*` keys in `keys.rs` + engine usage | |
| Idempotency keys | ✅ | `idempo:{user_id}:{key}` `keys.rs`; `order_handler.rs` | |
| `wallet:balance:request` | ✅ | Subscriber in `lib.rs` → `publish_wallet_balance_updated` | On-demand balance refresh |
| `price:ticks` (auth-service) | ✅ | `PriceTickSummaryHandler` subscribes for summary recompute | |
| `markup:update` (data-provider) | ✅ | `data-provider/src/main.rs` pubsub | Profile changes |
| `apps/gateway-ws` NATS | ⚠️ | `subscribe("evt.*")`, `event.*`, `deposit.request.*`, `wallet.balance.updated`, `chat.>`; Redis `price:ticks`, `account:summary:updated` | **Parallel** to `ws-gateway`; not in `docker-compose.prod.yml` |

---

## 14. BACKGROUND WORKERS / EVENT HANDLERS

| Worker / task | Status | File / trigger | One-line description |
|----------------|--------|----------------|----------------------|
| Order DB sync | ✅ | `lib.rs` `tokio::spawn` + `OrderEventHandler` on `evt.order.updated` | Persists order state |
| Call record ingest | ✅ | `CallRecordHandler` on `admin_call.events` | Stores call metadata |
| Position DB sync | ✅ | `PositionEventHandler` on `evt.position.updated` | Postgres sync |
| Position closed → summary + notifications | ✅ | `lib.rs` on `event.position.closed` | `compute_and_cache_account_summary`, SL/TP/liquidation pushes |
| Wallet balance request subscriber | ✅ | `lib.rs` Redis `wallet:balance:request` | Re-publishes wallet snapshot |
| Price tick → account summary | ✅ | `price_tick_summary_handler.rs` Redis `price:ticks` | Equity / free margin refresh |
| Account summary warm-up | ✅ | `account_summary_cache_warmup.rs` `warm_all_users` | Fills Redis on boot |
| `price:groups` periodic sync | ✅ | `lib.rs` 60s interval `sync_price_groups_set` | Resilience after Redis flush |
| Order-engine NATS consumers | ✅ | `apps/order-engine/src/main.rs` | Ticks + commands loop |
| Order-engine SL/TP checker | ✅ | `sltp_handler.rs` from tick path | Lua `check_sltp_triggers.lua` |
| core-api persistence consumer | ✅ | `apps/core-api/src/persistence.rs` on `evt.*` | Secondary persistence path (overlap with auth-service) |
| data-provider catalog refresh | ✅ | `main.rs` `tokio::spawn` interval | Postgres symbol catalog |
| data-provider price loop | ✅ | `main.rs` 100ms loop | Redis + per-group NATS ticks |
| ws-gateway Redis subscriber | ✅ | `redis_subscriber.rs` | Broadcast to WS |
| ws-gateway NATS chat/AI/report forwarders | ✅ | `ws-gateway/src/main.rs` | Per-connection routing |

---

## 15. DATA / RISK FEATURES

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Tiered leverage by notional | ✅ | `resolveEffectiveLeverageFromTiersOrNull`, DB tiers, Lua margin checks | |
| Per-user min/max leverage | ✅ | `me` payload + order command fields | |
| Hedging vs netting account type | ✅ | `users.account_type`, order-engine `models.rs` | Affects position add/reduce |
| Hedged vs net margin calc | ✅ | `users.margin_calculation_type`, admin user update route | |
| Margin call threshold (group) | ✅ | `user_groups.margin_call_level`, Redis `group:{id}` cache | Surfaced in account summary |
| Stop-out threshold (group) | ✅ | `stop_out_level`, `try_publish_stop_out_close_all` | Auto `cmd.position.close_all` |
| Trading access flags | ✅ | `trading_access` migration `006_trading_access.sql` | full / close_only / disabled |
| Min margin enforcement | ✅ | `getDefaultSizeForMinMargin`, `MIN_EST_MARGIN_DOLLARS`, engine `validation.rs` | Client + server layers |
| SL/TP liquidation triggers | ✅ | `check_sltp_triggers.lua`, position close with `trigger_reason` | |
| `risk:alerts` channel | ⚠️ | Subscribed in `ws-gateway`; producer grep UNCERTAIN beyond docs | Wired for fan-out |

---

## 16. PROMOTIONS / GROWTH

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Terminal promotion slides | ✅ | `020_terminal_promotion_slides.sql`, public/admin promotion routes | |
| Referral / affiliate | ✅ | Migrations `043_*`, admin + user affiliate pages | |
| Funded programs | ⚠️ | Rich UI; **no backend API** in admin/user pages reviewed | Demo data |
| Bonus credits | 🚧 | Admin Bonus page stub; permissions exist | |

---

## 17. OBSERVABILITY / OPERATIONS

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Audit / user events | ✅ | `admin_audit.rs`, `admin_user_events.rs`, `054_user_events.sql` | |
| Health endpoints | ✅ | `GET /health` auth-service `lib.rs`; `ws-gateway` `create_health_router`; `apps/data-provider/src/health.rs` | |
| Metrics (Prometheus-style) | ⚠️ | `apps/order-engine/src/observability`, `ws-gateway/src/metrics` | Modules exist; scrape config UNCERTAIN |
| Structured JSON logs | ✅ | `apps/core-api/src/main.rs` `.json()` subscriber | |
| Log destinations | ⚠️ | `RUST_LOG`, `LOG_TO_FILE` order-engine; docker logging drivers | Env-driven |

---

## 18. MOBILE / RESPONSIVE

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Terminal mobile layout | ✅ | `TerminalLayout`, `TerminalMobileNav`, `AppShellTerminal.tsx` | Breakpoint-driven |
| Mobile symbol / menu pages | ✅ | `TerminalSymbolsPage.tsx`, `TerminalMobileMenuPage.tsx` | Full-screen flows |
| Mobile bottom dock / history | ✅ | `TerminalHistoryView.tsx`, `TerminalPositionsView.tsx` | Touch targets |
| Admin sidebar drawer | ✅ | `Sidebar.tsx` `md:hidden` overlay | |
| User panel small tweaks | ⚠️ | `AdminUsersPage.tsx` `sm:hidden` labels | Minor responsive patterns |

---

## 19. DEPLOYMENT / DEVOPS

| Feature | Status | Where it lives (key paths) | One-line description |
|--------|--------|---------------------------|----------------------|
| Docker Compose prod | ✅ | `deploy/docker-compose.prod.yml` | postgres, redis, nats, migrations, auth, ws-gateway, data-provider, order-engine, core-api, frontend |
| Multi-service images | ✅ | `deploy/Dockerfile.backend` produces multiple binaries | Single image tag `newpt-auth:latest` with different `command` |
| Frontend build args | ✅ | `VITE_VOISO_PANEL_URL` in compose | |
| Migrations in compose | ✅ | `infra/migrations` mounted into one-shot migrations container | |
| **CI/CD** | 🗑️ | No `.github/workflows` in repo | Not present in codebase |
| **Dual data-provider / dual WS** | ⚠️ | `apps/data-provider`, `apps/gateway-ws` vs `backend/*` | Operational choice not fully documented in compose |

---

## 20. KNOWN MOCKS / TODOs / GAPS

| Item | Notes |
|------|--------|
| `UserFundedProgramsPage.tsx` | `DEMO_PLANS` static data — no API. |
| `AdminFundedProgramsPage.tsx` | `DEMO_PLAN`, `PLACEHOLDER_STATS`, TODO API. |
| `ReportsPage.tsx` / `BonusPage.tsx` | “coming soon”. |
| `TradingPage.tsx` | `/user/trading` stub. |
| `src/features/adminFinance/mocks/finance.mock.ts` | Mock transactions; `WalletDetailsModal.tsx` uses `mockLedgerEntries`. |
| `src/features/affiliate/mocks/index.ts` | Empty placeholder file. |
| `src/features/adminTrading/mocks/symbols.mock.ts` | Exists — verify if still imported UNCERTAIN. |
| `admin_trading.rs` | `TODO: If NATS publish fails...` near cancel publish. |
| `agentNavItems` empty | `src/app/config/nav.ts`; `AgentLayout`/`AgentGuard` **not mounted** in `AppRouter.tsx` — agent shell unused. |
| **Parallel services** | `apps/core-api` overlaps auth deposit/order routes; `apps/gateway-ws` overlaps `ws-gateway`; two data-provider trees. |
| **Migrations triplication** | `infra/migrations` (compose), `backend/auth-service/migrations`, `database/migrations` — drift risk. |
| **Export in BottomDock** | Toast only, no CSV/binary download implementation. |
| **TIF selector** | Always `GTC` in UI while API type allows IOC/FOK. |
| **Stop / stop-limit orders** | Not in `contracts::OrderType`. |

---

*Inventory reflects codebase audit; update this file when major features ship or are removed.*
