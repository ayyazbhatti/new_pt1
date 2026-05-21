    # Phase 1 — Trading costs (schema & admin configuration)

    This phase adds **database schema**, **admin API** for `fee_rules`, **group toggles** (`swap_enabled`, `fees_enabled`), and the **admin Fees UI**. **No charging logic** runs in production paths yet (no rows in `fee_charge_log` from normal order flow until Phase 2).

    ## Migrations

    | Location | File |
    |----------|------|
    | Infra | `infra/migrations/065_trading_costs_schema.sql` |
    | Auth service (mirror) | `backend/auth-service/migrations/20260525120000_trading_costs_schema.sql` |

    Contents:

    - `ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'swap';` (outside `BEGIN`, same pattern as `061_bonus_system.sql`).
    - `user_groups`: `swap_enabled`, `fees_enabled` (boolean, default `false`).
    - `positions`: `accumulated_swap_usd`, `accumulated_fees_usd` (numeric, default `0`).
    - Tables: `fee_rules`, `swap_charge_log`, `fee_charge_log` (indexes and comments as in spec).
    - Permissions: `fees:view`, `fees:edit` inserted under the existing **Swap** permission category; grants added for **Full Access** and **V2** profiles (`permission_profile_grants`).

    ## Backend

    | Area | Path |
    |------|------|
    | Fee rule models | `backend/auth-service/src/models/fee_rule.rs` |
    | Fee admin service | `backend/auth-service/src/services/admin_fees_service.rs` |
    | Fee admin routes | `backend/auth-service/src/routes/admin_fees.rs` |
    | Router mount | `backend/auth-service/src/lib.rs` — `.nest("/api/admin/fees", create_admin_fees_router(...))` |
    | Group model | `backend/auth-service/src/models/user_group.rs` — `swap_enabled`, `fees_enabled` |
    | Groups service | `backend/auth-service/src/services/admin_groups_service.rs` — list/create/update + `count_open_positions_in_group` |
    | Groups routes | `backend/auth-service/src/routes/admin_groups.rs` — DTOs, `GET /:id/open-positions-count` → `{ "count": number }` |

    ### Admin fee API

    - `GET /api/admin/fees` — list (query: `group_id`, `symbol`, `status`, `page`, `page_size`). Permission: `fees:view`.
    - `GET /api/admin/fees/:id` — `fees:view`.
    - `POST /api/admin/fees` — `fees:edit`.
    - `PUT /api/admin/fees/:id` — `fees:edit`.
    - `DELETE /api/admin/fees/:id` — `fees:edit` (204 No Content).

    ### Group API

    - Create/update payloads accept `swap_enabled` and `fees_enabled`.
    - `GET /api/admin/groups` / `GET /api/admin/groups/:id` return the new fields (via `SELECT` / `RETURNING *`).

    ## Frontend

    | Area | Path |
    |------|------|
    | Fees feature | `src/features/fees/` (`api/`, `components/`, `hooks/`, `pages/`, `types/`) |
    | Admin route | `/admin/fees` in `src/app/router/adminRoutes.tsx` |
    | Nav | `src/app/config/nav.ts` — “Trading fees” after “Swap Fees” |
    | Route permissions | `src/shared/utils/permissions.ts` — `fees:view` / `fees:edit`, `/admin/fees` |
    | Groups | `src/features/groups/types/group.ts`, `src/features/groups/api/groups.api.ts`, `src/features/groups/components/GroupFormDialog.tsx` |

    The group form loads `GET /api/admin/groups/:id/open-positions-count` when **editing** a group and shows a warning if the admin enables swap while the group had swap **off** at dialog open and there are open positions.

    Fee UI sends `fee_percent = bps / 10000` (basis points input).

    ## What does **not** happen yet

    - No fee deduction at order placement (Phase 2).
    - Swap rollover engine and `swap_charge_log` inserts from scheduled jobs — see **Phase 3** (`docs/phase-3-swap-engine.md`).
    - `fees_enabled` / `swap_enabled` do not trigger any engine by themselves.

    ## sqlx offline

    New queries use `sqlx::query_as` without `query!` macros; no `.sqlx` regeneration was required for this change set. If you add `query!` later, run `cargo sqlx prepare` against a DB that has applied `065`.

    ## Smoke test (manual)

    > Not executed in this workspace session (no live DB). After applying migrations on dev:

    1. `\d user_groups` — expect `swap_enabled`, `fees_enabled`.
    2. `\d fee_rules` — expect new table.
    3. Admin UI: `/admin/fees` — create rule (e.g. Default, 5 bps, min 0, max 100).
    4. Admin: edit Default group — enable both toggles, save, reload — toggles persist.
    5. Place a test order — confirm **no** `fee_charge_log` row (Phase 2).
    6. Confirm app logs clean.
