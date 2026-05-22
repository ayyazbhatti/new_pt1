# Phase 1 — Market sessions (schema, admin, symbol link)

This phase adds **database schema**, **seeded default session templates**, an **empty holidays table**, **admin CRUD** for templates and weekly windows, and a **session template override** on symbols. **Trading hours are not enforced** anywhere in the order path until Phase 2.

## Migration

- **Infra:** `infra/migrations/066_market_sessions_schema.sql`
- **Auth-service mirror:** `backend/auth-service/migrations/20260526180000_market_sessions_schema.sql`

Objects created:

- `market_session_templates` — name, IANA `timezone`, `is_24_7`, optional `is_default_for_market` (unique per market when set)
- `session_template_windows` — `day_of_week` 0–6 (Sun–Sat), `open_time` / `close_time` in template timezone (`open_time < close_time`; overnight split across days)
- `market_holidays` — placeholder for Phase 4 (no admin CRUD in Phase 1)
- `symbols.session_template_id` — nullable FK to templates (`ON DELETE SET NULL`)

Seeded defaults (by name): **Crypto 24/7**, **Forex 24/5**, **NYSE / NASDAQ**, **CME Commodities**, with windows for non–24/7 templates. `market_type` enum values used: `crypto`, `forex`, `stocks`, `commodities`.

Permissions (same pattern as trading-costs / fees): rows in `permissions` plus grants on **Full Access** and **v2** profiles for:

- `sessions:view`
- `sessions:edit`

## Backend

| Area | Path |
|------|------|
| Models | `backend/auth-service/src/models/market_session.rs` |
| Service | `backend/auth-service/src/services/admin_sessions_service.rs` |
| Routes | `backend/auth-service/src/routes/admin_sessions.rs` |
| Mount | `backend/auth-service/src/lib.rs` — `.nest("/api/admin/sessions", create_admin_sessions_router(...))` |

**HTTP API (all under `/api/admin/sessions`, JWT + permission checks):**

| Method | Path | Permission |
|--------|------|------------|
| GET | `/templates` | `sessions:view` |
| GET | `/templates/:id` | `sessions:view` |
| POST | `/templates` | `sessions:edit` |
| PUT | `/templates/:id` | `sessions:edit` (replaces all windows in one transaction) |
| DELETE | `/templates/:id` | `sessions:edit` (clears `symbols.session_template_id` for that template, then deletes template) |

**Symbols:** `CreateSymbolRequest` / `UpdateSymbolRequest` and list/detail JSON include optional `session_template_id` and display `session_template_name` (join). Implementation: `backend/auth-service/src/routes/admin_symbols.rs`, `backend/auth-service/src/services/admin_symbols_service.rs`, `backend/auth-service/src/models/symbol.rs`.

## Admin UI

- **Route:** `/admin/sessions`
- **Feature folder:** `src/features/marketSessions/` (page, API, hooks, `WeeklyScheduleEditor`, `SessionTemplateForm`, `SessionTemplatesTable`, `SessionTemplateSelect`)
- **Nav:** `src/app/config/nav.ts` — “Market sessions” (`sessions:view`)
- **Router:** `src/app/router/adminRoutes.tsx`
- **Permission constants:** `src/shared/utils/permissions.ts` (`ALL_PERMISSION_KEYS`, `ADMIN_PAGE_PERMISSIONS`, `ADMIN_ROUTE_PERMISSIONS`)

**Symbol modals:** `SessionTemplateSelect` is wired in `src/features/symbols/modals/EditSymbolModal.tsx` and `src/features/symbols/modals/AddSymbolModal.tsx`, with `marketHint` from `symbol.market` or `assetClassToMarketHint` (`src/features/marketSessions/utils/marketHint.ts`). The template list API requires **`sessions:view`**; the select skips fetching until that permission is present and shows a short hint otherwise. Payloads/types: `src/features/symbols/types/symbol.ts`, `src/features/symbols/api/symbols.api.ts`.

## Verification (automated)

- `cd backend/auth-service && cargo check` — **pass**
- `npx tsc --noEmit` (repo root) — **pass**
- `psql` applying `infra/migrations/066_market_sessions_schema.sql` — **pass** (with non-interactive DB credentials in this environment)
- Post-migration SQL checks:
  - `SELECT name, is_default_for_market, is_24_7 FROM market_session_templates` → **4 rows** (crypto, forex, stocks, commodities defaults)
  - Windows: **0** for crypto, **6** forex, **5** NYSE, **10** CME → **21** window rows total in verification query

## Smoke (manual / UI)

1. Open `/admin/sessions` with a profile that has `sessions:view` — list shows four seeded templates.
2. Edit **NYSE / NASDAQ**, add e.g. Tuesday **18:00–20:00**, save, reload — both windows present; remove extra window and save — back to five Mon–Fri rows.
3. `/admin/symbols` — edit a symbol — **Session template** dropdown (Auto + templates; default for market highlighted when hint matches).
4. Place a market order outside cash hours — **still succeeds** (no server-side session gate).

## Enforcement — explicitly not in this phase

- **No** reads of `market_session_templates`, `session_template_windows`, or `market_holidays` in `place_order`, order-engine, or tick paths.
- Phase 2 will add open/closed evaluation and reject or queue orders as designed.
