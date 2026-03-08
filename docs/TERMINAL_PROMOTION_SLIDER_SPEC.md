# Terminal Promotion Slider — Admin Control — Implementation Spec

**Version:** 1.2  
**Status:** Validated — ready for implementation  
**Last updated:** 2025-03-09

---

## Performance & optimization (no speed impact)

This feature **must not** slow down the terminal or the app. The following are mandatory:

- **No polling.** Per project rule (`.cursor/rules/no-polling.mdc`): do **not** use `setInterval` / `refetchInterval` to refetch promotions. Fetch **once on mount** when the right panel is visible; optional **on-demand** refetch only when the user opens the promotions admin page and saves (admin can refetch the terminal view manually if needed). No periodic timer-based refetch.
- **Non-blocking terminal load.** The terminal must **not** wait for the promotions API to render. Fetch promotions in the background (e.g. after first paint or in a `useEffect` that does not block the rest of `RightTradingPanel`). Show the promo block only when data has arrived (or hide if empty/error); the rest of the panel (order form, account summary, etc.) renders immediately.
- **Single, indexed query.** Public `GET /api/promotions/slides` runs one query: `SELECT ... FROM terminal_promotion_slides WHERE is_active = true ORDER BY sort_order ASC` with limit (e.g. 10). Index `(is_active, sort_order)` is used; no N+1, no joins.
- **Small payload.** Response is a small JSON array (typical size &lt; 5 KB for up to 10 slides). No large blobs or base64 images.
- **Images.** Slide images are loaded via `<img src={url}>` (external URLs). Use native lazy loading (`loading="lazy"`) so images do not block the initial render. No image decoding on the main thread beyond what the browser does by default.
- **Carousel.** Keep the existing pattern: CSS opacity transition for slide change, no full re-mount of the carousel on each tick. Auto-advance remains a simple `setInterval` that only updates slide **index** state (no API calls).
- **Admin page.** Admin promotions page loads data once when the page is opened (on-demand). No polling; refetch only after create/update/delete/reorder/toggle (event-driven).

These rules are part of the spec; implementation must follow them so that optimization and speed are not affected.

---

## Validation summary (why this will work)

- **Single backend:** All API routes are implemented in **auth-service** only. The frontend Vite proxy forwards `/api` and `/v1` to `http://127.0.0.1:3000` (auth-service). No proxy or CORS changes are required; the terminal and admin UI will call the same origin.
- **Auth flow:** Public endpoint `GET /api/promotions/slides` requires JWT (same as other `/api/*` user endpoints). The terminal is behind `AuthGuard`, so the user always has a token when the carousel loads.
- **Permissions:** New keys `promotions:view` and `promotions:edit` are added via migration and checked in auth-service using the same pattern as `admin_tags` / `admin_settings` (permission_profile_grants + profile from users).
- **DB:** New table and permissions are added in `infra/migrations/` and applied by the existing start script; auth-service already uses `DATABASE_URL` and the same Postgres.
- **Frontend:** New admin route and nav follow existing patterns (`adminRoutes.tsx`, `nav.ts`, `useCanAccess`); terminal uses existing `http()` with Bearer token. No new infra.

---

## 1. Overview

### 1.1 Goal

Replace the **static** promotion carousel in the user trading terminal (right panel) with an **admin-controlled** promotion slider. Admins will manage slides (create, edit, delete, reorder, enable/disable) from a dedicated admin page; the terminal will fetch and display the active slides in real time.

### 1.2 Current State

- **Location:** `src/features/terminal/components/RightTradingPanel.tsx`
- **Behaviour:** Hardcoded array `PROMO_SLIDES` (3 items: image URL, title, subtitle), auto-advance every 4 seconds, dot indicators, “Learn more” CTA with `toast('Coming soon')`.
- **Data:** Static; no backend, no persistence.

### 1.3 Out of Scope (for this spec)

- A/B testing or per-user/segment targeting.
- Rich media (video, HTML body); slides remain image + title + subtitle + optional link.
- Analytics (clicks, impressions) — can be added later.

---

## 2. Data Model

### 2.1 Database Table: `terminal_promotion_slides`

| Column           | Type         | Nullable | Description |
|------------------|--------------|----------|-------------|
| `id`             | `uuid`       | NO       | Primary key (default `gen_random_uuid()`). |
| `sort_order`     | `integer`    | NO       | Display order (ascending). Lower = earlier. |
| `image_url`      | `text`       | NO       | Full URL of the slide image. |
| `title`          | `varchar(255)` | NO     | Main heading (e.g. “Premium Analytics”). |
| `subtitle`       | `varchar(500)` | YES    | Optional subtext. |
| `link_url`       | `text`       | YES      | Optional CTA link (e.g. external page). If null, CTA can be hidden or show “Coming soon”. |
| `link_label`     | `varchar(100)` | YES    | Optional button label (e.g. “Learn more”). Default “Learn more” if link present. |
| `is_active`      | `boolean`    | NO       | Default `true`. Only active slides are returned by the public API. |
| `created_at`     | `timestamptz` | NO       | Default `now()`. |
| `updated_at`     | `timestamptz` | NO       | Default `now()`, updated on change. |

**Indexes:**

- `idx_terminal_promotion_slides_active_order` on `(is_active, sort_order)` for the public “list active” query.

**Constraints:**

- `image_url` and `title` must be non-empty (enforced in app/API).
- `sort_order`: no unique constraint (gaps and temporary duplicates during reorder are allowed); application assigns 0, 1, 2, … after reorder.

### 2.2 API DTOs (conceptual)

**Slide (response):**

- `id`, `sort_order`, `image_url`, `title`, `subtitle`, `link_url`, `link_label`, `is_active`, `created_at`, `updated_at`

**Create/Update (request):**

- Same fields as above (all optional on update except those required by validation). `id` and `created_at` are server-set.

---

## 3. API Design

**Backend:** All endpoints are implemented in **auth-service** only. The frontend proxies `/api` to auth-service (Vite `API_TARGET = 127.0.0.1:3000`); no core-api or second origin is used.

### 3.1 Public (terminal)

- **GET** `/api/promotions/slides`  
  - **Auth:** Required (JWT). Use the same `auth_middleware` as other user routes; terminal is behind AuthGuard so the client always sends Bearer token.  
  - **Response:** JSON array of slides where `is_active = true`, ordered by `sort_order` ascending.  
  - **Fields:** `id`, `sort_order`, `image_url`, `title`, `subtitle`, `link_url`, `link_label`.  
  - **Caching:** No server-side cache required; one simple indexed query. Frontend fetches once on mount (no polling).

**Route registration (auth-service):**  
- `.nest("/api/promotions", create_promotions_public_router(pool))`  
- Router: `.route("/slides", get(list_slides)).layer(auth_middleware).with_state(pool)`

### 3.2 Admin (CRUD + reorder + toggle)

All under `/api/admin/promotions`. Protect every handler with a permission check (e.g. `check_promotions_permission(pool, &claims, "promotions:view")` or `"promotions:edit"` as needed).

- **GET** `/api/admin/promotions/slides` — list all slides (active + inactive), ordered by `sort_order`. Permission: `promotions:view`.
- **POST** `/api/admin/promotions/slides` — create. Body: `{ image_url, title, subtitle?, link_url?, link_label?, is_active?, sort_order? }`. `sort_order` default = max + 1. Permission: `promotions:edit`.
- **PUT** `/api/admin/promotions/slides/:id` — update (partial). Permission: `promotions:edit`.
- **DELETE** `/api/admin/promotions/slides/:id` — physical delete. Permission: `promotions:edit`.
- **PATCH** `/api/admin/promotions/slides/reorder` — body: `{ order: string[] }` (array of slide UUIDs in desired order). Server sets `sort_order` to 0, 1, 2, … for each id. Permission: `promotions:edit`.
- **PATCH** `/api/admin/promotions/slides/:id/toggle` — body: `{ is_active: boolean }`. Permission: `promotions:edit`.

**Route registration (auth-service):**  
- `.nest("/api/admin/promotions", create_admin_promotions_router(pool))`  
- Router must define **more specific routes before parametric ones** (so `/slides/reorder` is not matched by `/slides/:id` with `id = "reorder"`):  
  - `.route("/slides", get(admin_list_slides).post(create_slide))`  
  - `.route("/slides/reorder", patch(reorder_slides))`  
  - `.route("/slides/:id/toggle", patch(toggle_slide))`  
  - `.route("/slides/:id", put(update_slide).delete(delete_slide))`  
  - `.layer(axum::middleware::from_fn(auth_middleware)).with_state(pool)`

---

## 4. Admin UI

### 4.1 Route & nav

- **Route:** `/admin/promotions` (or `/admin/terminal-promotions`).  
- **Nav:** Add an entry under admin sidebar, e.g. “Promotions” or “Terminal promotions”, with an icon (e.g. `Megaphone` or `Image` from `lucide-react`).  
- **Permission:** One permission, e.g. `promotions:view`; edit/delete/create can reuse the same or use `promotions:edit`. Only users with that permission see the nav item and can access the page.

### 4.2 Page layout

- **Title:** “Terminal promotion slider” (or “Promotions”).  
- **Short description:** e.g. “Slides shown in the right panel of the trading terminal. Order and visibility are controlled here.”  
- **Primary action:** “Add slide” (opens create modal).  
- **Content:** List/cards of slides with: thumbnail (image_url), title, subtitle (truncated), active badge, sort order, “Edit”, “Delete”, and drag handle for reorder (optional but recommended).

### 4.3 List behaviour

- **Order:** Same as API — by `sort_order` ascending.  
- **Reorder:** Drag-and-drop to change order; on drop, call `PATCH .../reorder` with new order.  
- **Empty state:** Message like “No slides yet. Add one to show promotions in the terminal.”

### 4.4 Create / Edit modal

- **Fields:**  
  - Image URL (required), Title (required), Subtitle (optional), Link URL (optional), Link label (optional), Active (checkbox, default on).  
  - Optional: Sort order (number) for create; usually auto-assigned.  
- **Validation:**  
  - Non-empty `image_url` and `title`.  
  - URL format for `image_url` and `link_url` if present.  
- **Submit:** Create → `POST`; Edit → `PUT`; then refetch list and close modal.  
- **Preview:** Optional small preview of the slide (image + title + subtitle) in the modal.

### 4.5 Delete

- Confirm dialog: “Delete this slide? This cannot be undone.”  
- On confirm: `DELETE .../slides/:id`, then refetch list.

### 4.6 Toggle active

- In the list row/card: toggle or “Active” badge; clicking calls `PATCH .../slides/:id/toggle` (or `PUT` with `is_active`), then refetch.

---

## 5. Terminal Integration (RightTradingPanel)

### 5.1 Data source

- **Remove:** Static `PROMO_SLIDES` and any hardcoded slide state.  
- **Add:** Fetch from `GET /api/promotions/slides` using the shared `http()` helper (sends Bearer token automatically). Call **once on mount** (non-blocking: do not delay render of the rest of the panel). **No polling:** no `setInterval` or `refetchInterval` to refetch this endpoint (per project no-polling rule).  
- **State:** Store result in component state as list of slides; use index 0 for initial `promoSlideIndex`.  
- **Empty response:** API returns `200` with `[]` when there are no active slides; terminal treats this as “no slides” and hides the promo block (no error).

### 5.2 Carousel behaviour

- **Slides:** Map over fetched slides; each item: `image_url`, `title`, `subtitle`, `link_url`, `link_label`. Use `loading="lazy"` on `<img>` so images do not block initial render.  
- **Auto-advance:** Keep 4s interval that only updates slide **index** state (no API call). Advance only if `slides.length > 1`.  
- **Dots:** One per slide; click sets current index.  
- **CTA button:**  
  - If slide has `link_url`: render link (e.g. `<a href={...} target="_blank" rel="noopener">`) with `link_label` or “Learn more”.  
  - If no `link_url`: keep current behaviour (e.g. “Learn more” with `toast('Coming soon')` or hide CTA).

### 5.3 Loading & empty states

- **Loading:** Show a skeleton or “Loading…” only in the promo block area; the rest of the right panel (form, account summary) renders immediately (fetch is non-blocking).  
- **Empty list (0 slides):** Hide the entire promo block so the right panel doesn’t show an empty carousel.  
- **Error:** On fetch error, hide the block or show a minimal “Promotions unavailable” message; do not block the rest of the panel.

### 5.4 Fallback

- If the public API does not exist yet (e.g. during rollout), keep a minimal in-code fallback (e.g. empty array or one generic slide) so the terminal never crashes; remove fallback once API is stable.

---

## 6. Permissions

- **Admin:**  
  - `promotions:view` — see admin page and list slides.  
  - `promotions:edit` — create, update, delete, reorder, toggle.  
- **Terminal:** No extra permission; any authenticated user can call `GET /api/promotions/slides` (JWT required; no promotion-specific permission).  
- **Backend:** Admin handlers must use the same pattern as `admin_tags` / `admin_settings`: resolve user’s `permission_profile_id` from `users`, then check `permission_profile_grants` for `promotions:view` / `promotions:edit`. Super-admin / role check can be used in addition if the app has a global admin role.  
- **Seed:** Add two rows to `permissions` in a migration (e.g. in the same migration that creates the table, or a dedicated one): `promotions:view`, `promotions:edit`, both under an existing category (e.g. Configuration — `a0000005-0000-0000-0000-000000000001`). Use `ON CONFLICT (permission_key) DO NOTHING` so the migration is idempotent.

---

## 7. Files & Components Checklist

### 7.1 Backend (auth-service only)

- [ ] **Migration:** New file `infra/migrations/020_terminal_promotion_slides.sql`: create table `terminal_promotion_slides`, index `idx_terminal_promotion_slides_active_order`, and seed `permissions` with `promotions:view` and `promotions:edit` (Configuration category), `ON CONFLICT (permission_key) DO NOTHING`.  
- [ ] **Module:** `backend/auth-service/src/routes/admin_promotions.rs` (or `promotions.rs` with two routers: one public, one admin).  
- [ ] **Public:** Handler for `GET /slides`: single query `WHERE is_active = true ORDER BY sort_order ASC LIMIT 10`, using index; JWT required via `auth_middleware`.  
- [ ] **Admin:** Handlers for GET all, POST, PUT, PATCH reorder, PATCH toggle, DELETE; each checks `check_promotions_permission(..., "promotions:view" | "promotions:edit")`.  
- [ ] **main.rs:** Register `.nest("/api/promotions", create_promotions_public_router(pool))` and `.nest("/api/admin/promotions", create_admin_promotions_router(pool))` (order does not matter; nest paths are distinct).

### 7.2 Frontend — admin

- [ ] Route: add `/admin/promotions` in `adminRoutes.tsx`.  
- [ ] Nav: add “Promotions” (or “Terminal promotions”) + icon + permission in `nav.ts`.  
- [ ] Feature folder: e.g. `src/features/adminPromotions/` with:  
  - [ ] `api/promotions.api.ts` — GET all (admin), create, update, delete, reorder, toggle.  
  - [ ] `types/promotions.ts` — TypeScript types for slide.  
  - [ ] `pages/AdminPromotionsPage.tsx` — list, “Add slide”, reorder, toggle, edit/delete.  
  - [ ] `modals/CreateEditPromoSlideModal.tsx` — form (image_url, title, subtitle, link_url, link_label, is_active).  
  - [ ] Optional: `components/PromoSlideCard.tsx` for list item + drag handle.

### 7.3 Frontend — terminal

- [ ] `src/features/terminal/api/promotions.api.ts` — `getPromotionSlides()` → `GET /api/promotions/slides`.  
- [ ] `RightTradingPanel.tsx`:  
  - [ ] Remove static `PROMO_SLIDES`.  
  - [ ] Add fetch **once on mount** (e.g. `useEffect` + state, or `useQuery` without `refetchInterval`), non-blocking; loading/error/empty handling.  
  - [ ] Render carousel from fetched slides; CTA from `link_url` / `link_label`; images with `loading="lazy"`.  
  - [ ] Do **not** add polling or refetch interval (per no-polling rule).

---

## 8. Implementation Order (phases)

1. **Backend:** Migration + public GET + admin CRUD + reorder + toggle.  
2. **Admin UI:** Page, list, create/edit modal, delete, toggle, reorder (drag-and-drop optional in v1).  
3. **Terminal:** Replace static slides with API fetch, loading/empty/error, CTA from `link_url`/`link_label`.  
4. **Polish:** Permissions in DB/backend if not already present, nav item, any UX tweaks (preview in modal, better empty states).

---

## 9. Validation & edge cases

- **Image URL:** Must be a valid URL; optionally allow only `https` (and same-origin if you host images).  
- **Link URL:** If present, valid URL; open in new tab with `rel="noopener noreferrer"`.  
- **Title / subtitle length:** Enforce DB limits (e.g. 255 / 500 chars); show character count in admin form if helpful.  
- **Max slides:** Enforce a limit (e.g. 10) in the public list query (`LIMIT 10`) and optionally in admin create to avoid abuse and keep the carousel and payload small (performance).  
- **Reorder:** If reorder fails, revert list order in UI or show error and refetch.  
- **Concurrent edits:** Last write wins; no optimistic locking in v1.

---

## 10. Summary

| Area            | Action |
|-----------------|--------|
| **DB**          | New table `terminal_promotion_slides` (migration 020); seed `promotions:view` and `promotions:edit` in `permissions`. |
| **API (auth-service)** | Public: GET `/api/promotions/slides` (JWT required). Admin: GET/POST/PUT/DELETE + PATCH reorder + PATCH toggle under `/api/admin/promotions/slides`. |
| **Admin UI**    | New page `/admin/promotions`, list + create/edit modal + delete + toggle + reorder; nav item with `promotions:view`. |
| **Terminal**    | RightTradingPanel fetches from `GET /api/promotions/slides` via `http()`; carousel uses API data; loading/empty/error handled; CTA uses link_url/link_label. |

---

## 11. Implementation guarantee checklist

Before coding, confirm:

- [ ] Vite proxy targets auth-service only (`/api` → `127.0.0.1:3000`). No change needed.
- [ ] Frontend uses `http()` from `@/shared/api/http` (Bearer token attached automatically for authenticated users).
- [ ] Terminal page is under `AuthGuard`; user has token when carousel mounts.
- [ ] Auth-service already has `auth_middleware` and permission-check helpers (e.g. `admin_tags`); new routes follow the same pattern.
- [ ] Migrations in `infra/migrations/` are applied by `scripts/start-all-servers.sh` (or manually); new migration will run with existing ones.

After implementation, verify:

- [ ] Admin can open `/admin/promotions` (with `promotions:view`), see list, add/edit/delete/toggle/reorder slides.
- [ ] Terminal right panel shows carousel from API; with 0 slides the block is hidden; with 1+ slides carousel and dots work; CTA uses link when present.
- [ ] Unauthenticated request to `GET /api/promotions/slides` returns 401.
- [ ] Admin request without `promotions:view` to `GET /api/admin/promotions/slides` returns 403.

**Performance (no speed impact):**

- [ ] No `setInterval` or `refetchInterval` for promotions API (fetch once on mount only).
- [ ] Terminal right panel renders without waiting for promotions (fetch is non-blocking).
- [ ] Public GET uses one query with `WHERE is_active = true ORDER BY sort_order LIMIT 10` and index.
- [ ] Slide images use `loading="lazy"`.

Once this spec is approved, implementation can follow the phases in §8. Any changes to routes, permissions, or field names should be reflected in this document.
