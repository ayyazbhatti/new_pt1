# Affiliate Pages – Plan to Make Fully Dynamic

**Status:** Validated for correctness, performance, and safety. Implementation order and indexes are chosen so existing flows (login, trading, order placement) are not slowed down.

This document describes what is needed to make both affiliate UIs fully dynamic:

- **Admin:** [http://localhost:5173/admin/affiliate](http://localhost:5173/admin/affiliate) – commission layers (create/edit/delete, persist)
- **User:** [http://localhost:5173/user/affiliate](http://localhost:5173/user/affiliate) – referral link, stats, referred users

---

## 1. Current State

### Admin Affiliate Page (`/admin/affiliate`)

- **UI:** Multi-level commission layers table; Add / Edit (inline) / Delete layers; “Current structure” summary.
- **Data:** All in **local React state** (`useState`). Default: Level 1 (10%), Level 2 (5%), Level 3 (2%). Changes are lost on refresh.
- **No API:** No load/save of layers.

### User Affiliate Page (`/user/affiliate`)

- **UI:** Referral link (read-only + Copy), stats cards (Total referrals, Total earned, Pending), “How it works”, “Referred users” empty state.
- **Data:**
  - **Referral link:** Uses `user.id.slice(0, 8)` as placeholder ref code. Backend has `users.referral_code` and auth sets it on register; **not** returned in login/me response today.
  - **Stats:** All show “—”; no API.
  - **Referred users:** Empty state; no API.

### Backend / DB (existing)

- **users:** `referral_code`, `referred_by_user_id` (auth-service uses these on register).
- **schema.sql:** `affiliates` (id, user_id, code, commission_type, commission_value, status), `affiliate_commissions` (affiliate_id, user_id, trade_id, amount, currency, status, paid_at).
- **Gap:** No “layers” concept in DB. No admin API for layers. No user-facing affiliate APIs (my stats, my referrals). `/me` (and login response) do not expose `referral_code`.

---

## 2. What We Need to Do

### 2.1 Backend – Commission Layers (Admin)

**Goal:** Admin can create/edit/delete commission layers and set commission % per level; data persisted and used for commission calculation.

| Step | What | Where |
|------|------|--------|
| 1 | **Migration:** New table `affiliate_commission_layers` (or `affiliate_layers`). | e.g. `database/migrations/XXXX_affiliate_layers.sql` |
| 2 | **Columns (suggestion):** `id`, `level` (int, 1-based), `name` (e.g. "Level 1 (direct)"), `commission_percent` (numeric), `created_at`, `updated_at`. Order by `level`. | Same migration |
| 3 | **Auth-service:** New module e.g. `routes/admin_affiliate.rs` (or extend existing if any). | `backend/auth-service/src/routes/` |
| 4 | **Endpoints (admin only):** | |
|  | `GET /api/admin/affiliate/layers` → list layers (ordered by level). | |
|  | `POST /api/admin/affiliate/layers` → create layer (body: name, commission_percent; level can be auto or sent). | |
|  | `PUT /api/admin/affiliate/layers/:id` → update layer (name, commission_percent). | |
|  | `DELETE /api/admin/affiliate/layers/:id` → delete layer. | |
| 5 | **Service/repo:** CRUD for `affiliate_commission_layers`. Reuse auth middleware + admin role check. | e.g. `services/admin_affiliate_service.rs` or inline in routes |
| 6 | **Register routes** in `main.rs` under `/api/admin/affiliate`. | `main.rs` |

**Admin UI then:** Replace local state with:

- `GET /api/admin/affiliate/layers` on load (e.g. React Query).
- Create layer → `POST`, then invalidate list.
- Edit → `PUT`, then invalidate list.
- Delete → `DELETE`, then invalidate list.

---

### 2.2 Backend – User Referral Code (User Affiliate Page)

**Goal:** User sees their real referral link built from their `referral_code`.

| Step | What | Where |
|------|------|--------|
| 1 | **Auth:** Include `referral_code` in login and `/me` responses. | `backend/auth-service` (e.g. `UserResponse` in auth routes, and wherever login builds user payload) |
| 2 | **Frontend auth types:** Add `referralCode?: string` to user type and to login/me response mapping. | `src/shared/store/auth.store.ts`, `src/shared/api/auth.api.ts` |
| 3 | **User affiliate page:** Build referral URL as `${origin}/register?ref=${user.referralCode}`. Fallback to current placeholder only when `referralCode` is missing. | `src/features/userPanel/pages/UserAffiliatePage.tsx` |

---

### 2.3 Backend – User Affiliate Stats & Referred Users (User Affiliate Page)

**Goal:** User sees real “Total referrals”, “Total earned”, “Pending” and a list of referred users.

| Step | What | Where |
|------|------|--------|
| 1 | **Endpoints (authenticated user, for self):** | Auth-service or core service that has user/affiliate data |
|  | `GET /api/user/affiliate/stats` (or `/api/account/affiliate/stats`) → `{ totalReferrals, totalEarned, pendingPayout }`. | |
|  | `GET /api/user/affiliate/referrals?page=1&page_size=20` → paginated list of users referred by current user (e.g. id, email, created_at). **Pagination is required** to keep response size and query time bounded. | |
| 2 | **Data source:** Use `users.referred_by_user_id = current_user_id` for referrals. Use `affiliate_commissions` (and possibly `affiliates` if you link user_id to affiliate_id) for earned/pending. If schema uses `affiliates.id` for “affiliate”, you may need to resolve current user → affiliate id first. | Backend service layer |
| 3 | **Frontend:** Call these from User Affiliate page; show in stats cards and in “Referred users” table. | `src/features/userPanel/pages/UserAffiliatePage.tsx` + new API module e.g. `src/features/userPanel/api/affiliate.api.ts` (or under `features/affiliate/api` for user endpoints) |

---

### 2.4 Backend – Commission Calculation (Multi-Level)

**Goal:** When a trade (or order) is completed, compute commission for each level of the referral chain and create `affiliate_commissions` rows.

| Step | What | Where |
|------|------|--------|
| 1 | **Resolve referral chain:** For the trading user, get chain: user → referred_by_user_id → that user’s referred_by_user_id → … (up to N levels from config). | Order/trade processing service (e.g. where orders are filled or where you already write ledger/commissions) |
| 2 | **Load layer config:** From `affiliate_commission_layers` (level → commission_percent). | Same service or shared affiliate service |
| 3 | **For each level:** Level 1 = direct referrer, Level 2 = referrer’s referrer, etc. Match level to layer, compute amount (e.g. trade volume × commission_percent / 100), insert into `affiliate_commissions` (and link to `affiliates` if your schema uses affiliate_id). | Same place |
| 4 | **Idempotency:** Ensure one commission record per (trade/order, level, affiliate) so re-runs don’t double-pay. | Schema or unique constraint / upsert logic |
| 5 | **Async execution:** Commission calculation must run **after** the order/trade is persisted (e.g. via job queue or background task). The HTTP response for the trade must **not** wait for commission inserts. | Prevents any slowdown of the trading/order path. |

This can be a separate task after layers and user-facing APIs are in place.

---

### 2.5 Frontend – Admin Affiliate Page (Fully Dynamic)

| Step | What | Where |
|------|------|--------|
| 1 | **API client:** `getLayers()`, `createLayer(name, commissionPercent)`, `updateLayer(id, name?, commissionPercent?)`, `deleteLayer(id)`. | e.g. `src/features/affiliate/api/affiliate.api.ts` (admin) |
| 2 | **React Query (or similar):** `useAffiliateLayers()` for list; mutations for create/update/delete with cache invalidation. | e.g. `src/features/affiliate/hooks/useAffiliateLayers.ts` |
| 3 | **Page:** Replace `useState` layers with data from `useAffiliateLayers()`. Add layer → `createLayer` mutation. Edit → `updateLayer`. Delete → `deleteLayer`. Loading and error states. | `src/features/affiliate/pages/AffiliatePage.tsx` |

---

### 2.6 Frontend – User Affiliate Page (Fully Dynamic)

| Step | What | Where |
|------|------|--------|
| 1 | **Auth:** Ensure `referralCode` is stored and available (from login/me). | After backend adds it to response; then auth store + auth.api types |
| 2 | **Referral link:** Use `user.referralCode` for `?ref=`. | `UserAffiliatePage.tsx` |
| 3 | **API client:** `getMyAffiliateStats()`, `getMyReferrals()`. | e.g. `src/features/userPanel/api/affiliate.api.ts` or shared `features/affiliate/api` |
| 4 | **Page:** Fetch stats and referrals on load; show in stat cards and in “Referred users” table. Use **pagination** for referrals (e.g. page size 20); load next page on demand or “Load more”. Include loading/empty/error states. | `UserAffiliatePage.tsx` |

---

## 3. Suggested Order of Work

1. **Backend: Affiliate layers (admin)**  
   Migration + CRUD API + register routes.

2. **Frontend: Admin affiliate page**  
   API client + hooks + wire AffiliatePage to real layers (load/save).

3. **Backend: Expose `referral_code`**  
   Login + /me; then frontend auth types + user affiliate page referral link.

4. **Backend: User affiliate stats + referrals**  
   Endpoints + implementation using `users.referred_by_user_id` and `affiliate_commissions`.

5. **Frontend: User affiliate page**  
   Stats and referred users API + wire UI.

6. **Backend: Commission calculation (multi-level)**  
   On trade/order completion, resolve chain, apply layers, write `affiliate_commissions`.

---

## 4. Summary Table

| Area | Current | To make dynamic |
|------|--------|------------------|
| **Admin – layers** | Local state only | New table + admin CRUD API; admin page uses API for list/create/update/delete. |
| **User – referral link** | Placeholder from `user.id` | Backend returns `referral_code` in login/me; frontend uses it for `?ref=`. |
| **User – stats** | “—” placeholders | Backend stats endpoint; frontend fetches and displays. |
| **User – referred users** | Empty state | Backend referrals endpoint; frontend fetches and displays list. |
| **Commission calculation** | Not implemented | Backend: on trade/order, use layers + referral chain, insert `affiliate_commissions`. |

Once these are done, both [admin affiliate](http://localhost:5173/admin/affiliate) and [user affiliate](http://localhost:5173/user/affiliate) will be fully dynamic end to end.

---

## 5. Performance & Optimization (No Speed Impact)

All changes are designed so they **do not slow down** existing flows (login, trading, order processing).

| Area | Approach | Why it’s safe for speed |
|------|----------|--------------------------|
| **Layers table** | Small config table (typically &lt;20 rows). Single indexed query by `level` or `id`. | Minimal data; no heavy joins. |
| **Layers API** | `GET /layers` returns full list (no pagination needed). Admin only, low traffic. | Small payload; acceptable to load all layers once per page. |
| **Login/me + referral_code** | Add one optional column to existing user select. No extra query. | Same single user row; one extra string in JSON response. |
| **User stats endpoint** | One query for referral count (`COUNT` on `users`), one for earned/pending (`SUM` on `affiliate_commissions`). Use indexed columns. | Two lightweight aggregations; add indexes below. |
| **User referrals list** | **Pagination required:** e.g. `?page=1&page_size=20`. Query `users WHERE referred_by_user_id = :id` with `LIMIT/OFFSET` or cursor, indexed. | Avoids large result sets; index on `referred_by_user_id` keeps it fast. |
| **Commission calculation** | Run **asynchronously** (e.g. after order/trade is persisted): enqueue job or background task that loads layers once, walks referral chain (bounded by max level), inserts commissions. **Do not block** the main order/trade response. | Trade path stays fast; commission run is off the critical path. |
| **Frontend** | React Query with sensible `staleTime` (e.g. 60s for layers, 30s for user stats) so we don’t over-fetch. Referrals list: fetch one page at a time. | Fewer requests; no unnecessary refetches. |

**Database indexes to add (in migration):**

- `affiliate_commission_layers`: index on `level` (for ordered read).
- `users`: index on `referred_by_user_id` (for “my referrals” and chain walk).
- `affiliate_commissions`: existing indexes on `affiliate_id`, `user_id`, `status`; add composite if we often filter by (affiliate_id, status) for payouts.

These keep affiliate queries bounded and indexed; no full table scans on hot paths.

---

## 6. Validation & Safety

| Concern | Mitigation |
|--------|------------|
| **Double commission** | Unique constraint or unique index on `(source_trade_id, level, affiliate_id)` (or equivalent) in `affiliate_commissions`; use INSERT … ON CONFLICT DO NOTHING or check-before-insert in commission job. |
| **Layer order** | Store `level` as integer; API returns layers ordered by `level`. Admin UI can enforce level &gt; 0 and optional uniqueness. |
| **Commission percent** | DB constraint: `commission_percent >= 0 AND commission_percent <= 100`. Validate in API. |
| **Referral chain depth** | Cap at e.g. 10 levels when walking chain; configurable max from layers table size. Prevents runaway loops. |
| **Admin-only layers** | Use existing auth middleware + admin (or permission) check; no new permission required if already behind admin routes. |
| **User-only stats/referrals** | Endpoints use current user id from JWT; never accept user_id from query/body for “my” data. |

---

## 7. Assumptions & Scope

- **In scope:** Admin layer CRUD, user referral link (from `referral_code`), user stats and referred-users list, and multi-level commission calculation that does not block trading.
- **Out of scope for this plan:** Payout workflow (marking commissions as paid, withdrawals), affiliate sign-up approval, or changes to existing `affiliates` table semantics until we align with multi-level model.
- **Existing behavior:** Register flow and `users.referral_code` / `referred_by_user_id` remain unchanged except that we expose `referral_code` in login/me. No change to login/register response size in a way that would hurt performance.

---

## 8. Implementation Order (Unchanged)

Same as Section 3. Work in this order so that each step has a clear deliverable and we don’t block the critical path (trading/orders) until commission calculation is implemented as an async step.
