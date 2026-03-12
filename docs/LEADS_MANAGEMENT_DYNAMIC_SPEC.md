# Leads Management – Dynamic (API-Driven) Implementation Spec

This document specifies how to move the **Leads Management** UI from the current **in-memory / mock** implementation to a **fully dynamic, backend-driven** solution. It defines the API contract, frontend integration pattern, and migration steps so that implementation can be done consistently and professionally.

**Prerequisites:** You have read `LEADS_MANAGEMENT_MODULE.md` (concepts, data model) and `LEADS_MANAGEMENT_UI_PLAN.md` (UI spec). The current UI (list, detail, filters, table, modals, import/export, stats) is implemented and working against an in-memory store.

**Goal:** Replace the in-memory store and mock API with real HTTP calls to a backend. The UI stays the same; only the data layer and related state management change.

**Validation:** This spec has been cross-checked against the codebase. The only breaking change is `listLeads()` → `listLeads(params)` returning `{ items, total }`; all other API function signatures stay the same. React Query and `useDebouncedValue` already exist; the same patterns as the Admin Users page will be used.

**Correctness and performance:** Section 10 (Performance and Optimization Guarantees) defines rules so that (1) the feature **works 100%** (404 handling, errors, empty state, invalidation scope), and (2) **optimization and speed are preserved** (no polling, debounced search, single request per view, placeholder data to avoid flash, no redundant or N+1 requests, and safe import/export for large data). Implementation must follow Section 10.

---

## 1. Current State vs Target State

| Aspect | Current (static) | Target (dynamic) |
|--------|------------------|------------------|
| **Data source** | Zustand store with demo data (`leadsStore.ts`) | Backend REST API |
| **List** | Client-side filter/paginate over full store | Server-side pagination, search, filters (API) |
| **Detail** | Read lead by id from store | `GET /api/leads/:id` |
| **Activities** | From store `getActivitiesByLeadId` | `GET /api/leads/:id/activities` (or embedded) |
| **Create/Update/Delete** | Store mutations | POST/PATCH/DELETE to API |
| **Import** | Parse CSV, call `createLead` in loop (store) | Bulk API or same loop with real `createLead` API |
| **Export** | Client-side CSV from filtered list | Optional: server export endpoint or keep client export from API data |
| **Stats (KPI cards)** | Derived from full store | From API (e.g. `GET /api/leads/stats`) or derived from list response |
| **Permissions** | Frontend-only (`useCanAccess`) | Backend enforces; frontend hides UI by same keys |

---

## 2. Backend API Contract

The backend **must** expose the following. All paths are relative to the API base (e.g. `/api` or your gateway). Use **JSON** for request/response bodies. Use **ISO 8601** for dates.

### 2.1 List leads (paginated, filterable, searchable)

- **Method/URL:** `GET /api/leads` (or `/api/admin/leads` if namespaced)
- **Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No (default 1) | Page number (1-based) |
| `page_size` | number | No (default 20) | Items per page (e.g. 10, 20, 50, 100) |
| `search` | string | No | Full-text search (name, email, company, phone – backend-defined) |
| `status` | string | No | Filter by status (e.g. `new`, `contacted`, `converted`). Omit or `all` = no filter |
| `source` | string | No | Filter by source (e.g. `website`, `referral`). Omit or `all` = no filter |
| `owner_id` | string | No | Filter by owner user id. `unassigned` = no owner. Omit = all |
| `sort` | string | No | Sort field (e.g. `created_at`, `last_activity_at`, `score`) |
| `order` | string | No | `asc` or `desc` (default `desc` for dates) |

- **Response (200):**

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "phone": "string | null",
      "company": "string | null",
      "source": "string",
      "campaign": "string | null",
      "status": "string",
      "owner_id": "string | null",
      "owner_name": "string | null",
      "score": "number | null",
      "created_at": "ISO8601",
      "updated_at": "ISO8601",
      "last_activity_at": "ISO8601 | null",
      "converted_user_id": "string | null",
      "converted_at": "ISO8601 | null"
    }
  ],
  "total": 123
}
```

- **Behaviour:** Backend applies filters and search, returns only the requested page and total count. Permissions: only users with `leads:view` (or equivalent) can call; optionally scope by `owner_id` for “my leads” vs “all leads”.

---

### 2.2 Get single lead

- **Method/URL:** `GET /api/leads/:id`
- **Response (200):** Single lead object (same shape as list item).
- **Errors:** `404` if not found; `403` if no permission.

---

### 2.3 Get lead activities

- **Method/URL:** `GET /api/leads/:id/activities`
- **Query (optional):** `page`, `page_size` if backend supports pagination for activities; otherwise return all (with a reasonable limit, e.g. 100).
- **Response (200):** Either `{ "items": [ ... ] }` (preferred) or a direct array `[ ... ]`. Frontend will map both to `LeadActivity[]` (camelCase: `lead_id` → `leadId`, `created_at` → `createdAt`, `created_by` → `createdBy`).

```json
{
  "items": [
    {
      "id": "string",
      "lead_id": "string",
      "type": "note | call | email | status_change",
      "content": "string",
      "created_at": "ISO8601",
      "created_by": "string",
      "meta": {}
    }
  ]
}
```

- **Order:** Newest first (backend or client).

---

### 2.4 Create lead

- **Method/URL:** `POST /api/leads`
- **Body:**

```json
{
  "name": "string",
  "email": "string",
  "phone": "string | null",
  "company": "string | null",
  "source": "string",
  "campaign": "string | null",
  "status": "string | null",
  "owner_id": "string | null",
  "score": "number | null",
  "notes": "string | null"
}
```

- **Response (201):** Created lead object (full shape).
- **Errors:** `400` validation (e.g. duplicate email if unique); `403` if no `leads:create`.

---

### 2.5 Update lead

- **Method/URL:** `PATCH /api/leads/:id`
- **Body:** Same fields as create, all optional (partial update).
- **Response (200):** Updated lead object.
- **Errors:** `400` validation; `403` no `leads:edit`; `404` not found.

---

### 2.6 Delete lead

- **Method/URL:** `DELETE /api/leads/:id`
- **Response:** `204 No Content` or `200` with empty body.
- **Errors:** `403` no `leads:delete`; `404` not found.

---

### 2.7 Add activity

- **Method/URL:** `POST /api/leads/:id/activities`
- **Body:**

```json
{
  "type": "note | call | email | status_change",
  "content": "string",
  "meta": {}
}
```

- **Response (201):** Created activity object. Backend should set `created_by` from auth context and `created_at`.
- **Errors:** `400` invalid type/content; `403` no permission; `404` lead not found.

---

### 2.8 Convert lead

- **Method/URL:** `POST /api/leads/:id/convert`
- **Body:**

```json
{
  "user_id": "string | null"
}
```

- **Semantics:** If `user_id` is provided, link lead to that existing user; otherwise backend may create a new user from lead email/name and link. Set lead `status` to `converted`, set `converted_at` and `converted_user_id`.
- **Response (200):** Updated lead object.
- **Errors:** `400` (e.g. already converted, invalid user); `403` no `leads:convert`; `404` not found.

---

### 2.9 Lead statistics (optional but recommended)

- **Method/URL:** `GET /api/leads/stats`
- **Query:** Optional same filters as list (`search`, `status`, `source`, `owner_id`) so stats match current view.
- **Response (200):**

```json
{
  "total": 100,
  "by_status": {
    "new": 20,
    "contacted": 15,
    "qualified": 10,
    "proposal_sent": 8,
    "negotiation": 5,
    "converted": 30,
    "lost": 12
  },
  "conversion_rate_percent": 30
}
```

- **Purpose:** Power the KPI cards without loading full list. If not implemented, frontend can derive stats from the first page or a separate small aggregate endpoint.

---

### 2.10 List assignable owners (optional)

- **Method/URL:** `GET /api/leads/owners` or re-use existing users API with a role/filter (e.g. users with `leads:view` or “sales” role).
- **Response:** List of `{ id, name, email }` for dropdowns (Assign owner, Add lead owner).
- **Purpose:** Replace `MOCK_OWNERS` in AssignOwnerModal and AddLeadModal.

---

## 3. Frontend Integration

### 3.1 No polling

Per project rules: **no polling** (no `setInterval` or `refetchInterval` for leads data). Use:

- **On-demand:** Fetch when the user opens the list, navigates to detail, or applies filters.
- **After mutations:** After create/update/delete/convert/add activity, invalidate the relevant React Query keys so the next read refetches.
- **Real-time (optional):** If the backend supports WebSocket or SSE for “lead updated” events, subscribe and invalidate or update cache when events arrive.

### 3.2 Data layer pattern

- **HTTP client:** Use the existing `http()` from `@/shared/api/http`. It throws on non-2xx with `error.response.status` and `error.response.data`; use this to map 404 on `getLeadById` to `null` so the detail page’s “Lead not found” flow works without change.
- **API module:** Replace the body of `src/features/adminLeads/api/leads.api.ts` with real HTTP calls. Map backend snake_case to frontend camelCase (e.g. `owner_name` → `ownerName`, `created_at` → `createdAt`). **Signatures:**
  - **`listLeads(params?: ListLeadsParams): Promise<ListLeadsResponse>`** — **Only this signature changes.** Add types: `ListLeadsParams` (page, page_size, search, status, source, owner_id?, sort?, order?) and `ListLeadsResponse` (`{ items: Lead[], total: number }`). Current code uses `listLeads()` returning `Promise<Lead[]>`; the list page will be updated to use the new signature and pass params.
  - **All other functions keep their current signatures:** `getLeadById(id) => Promise<Lead | null>` (on HTTP 404, catch and return `null`); `getLeadActivities(leadId) => Promise<LeadActivity[]>` (return `response.items` mapped to camelCase); `createLead`, `updateLead`, `deleteLead`, `addLeadActivity`, `convertLead` unchanged so modals and detail page need no signature changes.
- **List:** Use **server-side pagination**. The list page sends `page`, `page_size`, `search`, `status`, `source` to `GET /api/leads` and displays `items` + `total`. Debounce search with existing `useDebouncedValue(filters.search, 400)` (same as Users page) and reset to page 1 when filters change.

### 3.3 React Query (recommended)

- **List:** One query key, e.g. `['leads', page, pageSize, debouncedSearch, filters.status, filters.source]`. Query function calls `listLeads(params)`. Use `keepPreviousData` (or equivalent) so the table doesn’t flash when changing page.
- **Detail:** Query key `['leads', id]`. Query function calls `getLeadById(id)`. Enabled only when `id` is present.
- **Activities:** Query key `['leads', leadId, 'activities']`. Query function calls `getLeadActivities(leadId)`. Enabled when viewing the Activity tab or detail.
- **Stats:** Optional query key `['leads', 'stats', filterHash]` if you have a stats endpoint; otherwise derive from list response or omit.
- **Mutations and invalidation:** Use `useQueryClient()` in the **list page** and **detail page**. When opening modals, pass an `onSuccess` callback that invalidates the right keys so data refetches:
  - **List page:** For Add lead, Import, and any modal that creates/updates/deletes a lead, pass `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] })` so the list refetches. For Add lead, you can also navigate to the new lead and invalidate `['leads', newId]` if the user is redirected to detail.
  - **Detail page:** For Edit, Assign, Convert, Delete, Add activity, pass `onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leads'] }); queryClient.invalidateQueries({ queryKey: ['leads', id] }); queryClient.invalidateQueries({ queryKey: ['leads', id, 'activities'] }); }` so both list and detail (and activity tab) stay in sync. Delete modal already navigates to list; invalidate `['leads']` so the list refetches.
  - Modals do not need to know about React Query; they just call the API and then the `onSuccess()` passed from the parent. The parent is responsible for invalidating.

### 3.4 Zustand store

- **Remove** or **repurpose** the leads store:
  - **Option A:** Remove it. All reads go through React Query; mutations go through API and then invalidation.
  - **Option B:** Keep a minimal store only for non-server state (e.g. “selected lead ids” for future bulk actions, or UI toggles). Do **not** keep `leads` and `activities` in the store once the API is live.

### 3.5 Permissions

- Backend must enforce `leads:view`, `leads:create`, `leads:edit`, `leads:delete`, `leads:assign`, `leads:convert`, `leads:export` (or your naming). Frontend continues to use `useCanAccess('leads:view')` etc. to show/hide buttons and tabs. If the backend returns `403` for an action, show a toast and do not update UI optimistically for that action.

### 3.6 Import / Export

- **Import:** Keep the current flow: user uploads CSV, frontend parses and validates rows, then in a loop calls `createLead` (which will be the real API). Optionally add a **bulk** endpoint `POST /api/leads/bulk` that accepts an array of lead payloads and returns created + errors; then the frontend calls it once and shows “N imported, M failed”.
- **Export:** Either (1) keep client-side export: use the **current filtered list** (all pages if you want “export all matching” you may need to fetch all pages or a dedicated export endpoint), or (2) add `GET /api/leads/export?search=...&status=...&format=csv` that returns a CSV file. Prefer (2) for large datasets.

---

## 4. File-by-File Migration Checklist

Use this as a step-by-step plan. Order can be adjusted if backend is not ready (e.g. keep mock behind a feature flag).

| # | File / area | Action |
|---|-------------|--------|
| 1 | **Backend** | Implement `GET/POST /api/leads`, `GET/PATCH/DELETE /api/leads/:id`, `GET/POST /api/leads/:id/activities`, `POST /api/leads/:id/convert`. Optional: `GET /api/leads/stats`, `GET /api/leads/owners`, `GET /api/leads/export`. |
| 2 | `src/features/adminLeads/api/leads.api.ts` | Replace store usage with `http()` calls. Add types for API responses (snake_case). Map responses to existing `Lead` / `LeadActivity` types. Implement `listLeads(params)` with pagination and filters. |
| 3 | `src/features/adminLeads/store/leadsStore.ts` | Remove demo data and list/activities from store; delete store or keep only UI state (e.g. selection). Update or remove any component that still reads `leads` / `activities` from store. |
| 4 | `src/features/adminLeads/pages/AdminLeadsPage.tsx` | Switch to React Query for list: `useQuery(['leads', page, pageSize, debouncedSearch, filters])`, use `listLeads(...)`. Use `total` from response for pagination. Optional: separate query for stats if endpoint exists. Remove dependency on `useLeadsStore` for leads list. |
| 5 | `src/features/adminLeads/components/LeadsTable.tsx` | No API calls here; receives `leads` and `pagination` from parent. Ensure parent passes API-driven data. |
| 6 | `src/features/adminLeads/pages/AdminLeadDetailPage.tsx` | Use `useQuery(['leads', id], () => getLeadById(id))` for lead; `useQuery(['leads', id, 'activities'], () => getLeadActivities(id))` for activities. Handle 404 (lead not found). Invalidate on mutation success. |
| 7 | Modals (Add, Edit, Convert, Assign, Activity, Delete) | Each modal calls the API functions from `leads.api.ts`. On success: close modal, call `onSuccess()`, and in the parent (or via queryClient invalidation) invalidate `['leads']` and/or `['leads', id]` so list/detail refetch. |
| 8 | `ImportLeadsModal` | Keep CSV parse + validation; replace `createLead` calls with the same API (now HTTP). Optionally add “bulk import” endpoint and call it once. |
| 9 | Export (header button) | If using client export: ensure the exported set is the one returned by the API (e.g. “Export current page” or “Export all matching” by fetching with same filters and iterating pages or using export endpoint). |
| 10 | AssignOwnerModal / AddLeadModal | Replace `MOCK_OWNERS` with `GET /api/leads/owners` (or users list) when that endpoint exists. |

---

## 5. Error Handling and Loading

- **Loading:** Use React Query’s `isLoading` / `isFetching` to show skeletons or “Updating…” in the table (as on the Users page). For detail, show skeleton until lead is loaded.
- **404:** On `getLeadById` 404, show “Lead not found” and “Back to leads” (already in place).
- **4xx/5xx:** Show a toast with the backend error message; do not clear the previous data so the user can retry or adjust filters.
- **Optimistic updates:** Optional for status/owner change (update cache immediately, rollback on error). Prefer simple “invalidate after success” for the first iteration.

---

## 6. Backend Data Model Alignment

Backend fields should align with the frontend types in `src/features/adminLeads/types/leads.ts`:

- **Lead:** id, name, email, phone, company, source, campaign, status, owner_id, owner_name, score, created_at, updated_at, last_activity_at, converted_user_id, converted_at.
- **LeadActivity:** id, lead_id, type, content, created_at, created_by, meta.
- **Status/Source:** Use the same enum values (e.g. `new`, `contacted`, …, `website`, `referral`, …) or map in the API layer so the UI labels still work.

---

## 7. Summary

| Deliverable | Description |
|-------------|-------------|
| **Backend** | REST API for list (paginated, filtered), get one, create, update, delete, activities, convert; optional stats and owners. |
| **Frontend API layer** | `leads.api.ts` talks to HTTP only; same function names and return types as today; map snake_case → camelCase. |
| **State** | React Query for list, detail, activities (and optional stats); no polling; invalidate on mutations. |
| **Store** | Remove or minimize Zustand (no server data in store). |
| **UI** | Unchanged layout and components; only data source and pagination/filter behaviour become server-driven. |
| **Import/Export** | Import: loop over CSV rows → real createLead API (or bulk endpoint). Export: client from API data or server CSV endpoint. |

Once this spec is validated and the backend contract is agreed, implementation can proceed in the order of the migration checklist above.

---

## 8. Fallback When Backend Is Not Ready

- **Option A (recommended):** Implement the frontend against the new API contract. If the backend is not deployed yet, use a **feature flag or environment variable** (e.g. `VITE_LEADS_USE_API=false`) so that when `false`, `leads.api.ts` continues to use the existing in-memory store (current behaviour). When `true`, use HTTP. This allows the UI to be developed and tested against the real API later without breaking the app.
- **Option B:** Deploy backend first, then switch the frontend in one go. The checklist order supports this (backend step 1, then frontend steps 2–10).

---

## 9. Validation Checklist (Pre-Implementation)

Use this to confirm the plan is complete and will work:

- [ ] **Backend contract:** All endpoints (list, get, create, update, delete, activities, convert) and request/response shapes are defined and agreed.
- [ ] **List API:** `listLeads(params)` returns `{ items, total }`; list page will be the only consumer that changes to use params and pagination from the response.
- [ ] **404 handling:** `getLeadById` will catch HTTP 404 and return `null` so existing “Lead not found” UI works.
- [ ] **No polling:** Only on-demand fetch and invalidation after mutations; no `refetchInterval`.
- [ ] **Debounce:** List page uses `useDebouncedValue(filters.search, 400)` (already used on Users page).
- [ ] **Invalidation:** List and detail pages pass `onSuccess` to modals that call `queryClient.invalidateQueries` with the correct keys.
- [ ] **Store:** Plan is to remove or repurpose the Zustand store so no component reads `leads` / `activities` from it after migration.
- [ ] **Import/Export:** Import keeps calling `createLead` per row (or bulk endpoint); export uses API data (current page, all pages, or server export).
- [ ] **Optional endpoints:** Stats and owners are optional; frontend can derive stats from list or show “—” until backend adds them.
- [ ] **Types:** Add `ListLeadsParams` and `ListLeadsResponse` (and optional API response DTOs for snake_case) in `leads.api.ts` or `types/leads.ts` so the list page and API layer are type-safe.
- [ ] **Performance (Section 10):** List query uses stable keys and `placeholderData: keepPreviousData`; detail/activities use `enabled: !!id` / `!!leadId`; search debounced 400 ms; no extra stats request without stats API; import/export rules for large data followed.

---

## 10. Performance and Optimization Guarantees

These rules ensure the dynamic implementation **will not slow down the app** and will behave correctly under load.

### 10.1 No extra or redundant requests

- **List:** One request per unique `(page, page_size, search, status, source)`. React Query deduplicates by query key: the same key never fires twice at the same time. Use a **stable query key** that includes only the values actually sent to the API (e.g. omit `search` when it’s empty, or send as undefined; backend ignores undefined).
- **Detail:** Fetch lead by id only when `id` is present (route param). Use `enabled: !!id` so the query does not run on the list page.
- **Activities:** Fetch only when viewing a lead (e.g. `enabled: !!leadId`). Do not fetch activities on the list page. Optionally fetch only when the user switches to the Activity tab (lazy) to save one request when they only view Overview.
- **Stats:** If there is no `GET /api/leads/stats`, do **not** issue extra list requests just to compute stats. Either use a dedicated stats endpoint, or show only the **total** from the current list response (list query already returns `total`) and show “—” or a loading state for the other KPI cards until a stats API exists. This avoids N+1 or double-fetch.

### 10.2 Avoid UI jank and unnecessary refetches

- **Debounce search:** Use `useDebouncedValue(filters.search, 400)` (same as Users page). Never send a request on every keystroke.
- **Placeholder data:** Use `placeholderData: keepPreviousData` (or React Query v5 `placeholderData: keepPreviousData`) for the **list** query so that when the user changes page or filters, the previous table data stays visible until the new response arrives. No blank flash; same pattern as Admin Users page.
- **Initial vs refetch loading:** Distinguish “no data yet” (show full-page or table skeleton) from “refetch in background” (show small “Updating…” indicator only). Use `isLoading && !data` for initial load and `isFetching` for background refetch, as on the Users page. This keeps the UI responsive and avoids full-page spinners on every invalidation.

### 10.3 Invalidation and cache

- **Invalidate only what changed:** After a mutation (create/update/delete/convert/add activity), invalidate only the relevant keys (e.g. `['leads']` for list, `['leads', id]` for detail, `['leads', id, 'activities']` for activities). React Query will refetch those queries when they are next used (e.g. when the user returns to the list or stays on the detail page). Do **not** use `refetchInterval` or polling.
- **Optional staleTime:** You may set `staleTime: 30_000` (30 seconds) for the list query so that when the user switches tabs and comes back, React Query does not refetch immediately if the data is still fresh. Invalidation after a mutation still marks data stale, so the next read will refetch. This reduces redundant requests without affecting correctness.

### 10.4 Heavy operations: Import and export

- **Import:** For large CSVs (e.g. >50 rows), prefer a **bulk** endpoint `POST /api/leads/bulk` so the frontend sends one request instead of N. If only per-row `createLead` exists, the frontend can still loop but should show a progress indicator and consider batching (e.g. 10 at a time) to avoid blocking the UI and to avoid overloading the server with hundreds of concurrent requests.
- **Export:** If export is client-side and “Export all” is allowed, avoid fetching all pages in a tight loop (many requests). Prefer either (1) “Export current page only” with a single request’s data, or (2) a server-side `GET /api/leads/export?…&format=csv` that streams the full result. This keeps the app fast and avoids timeouts.

### 10.5 Correctness guarantees (100% behaviour)

- **404:** `getLeadById` catches HTTP 404 and returns `null`. The detail page already handles `!lead` with “Lead not found” and “Back to leads”. No change needed in the UI.
- **Errors:** On 4xx/5xx, show a toast and do **not** clear previous data (keep last successful data so the user can retry or change filters).
- **Empty list:** When the API returns `items: []` and `total: 0`, show the same empty state as today (“No leads match your filters” or “No leads yet”). No extra request.
- **Invalidation scope:** List page modals (Add, Import) invalidate `['leads']` so the list refetches. Detail page modals (Edit, Assign, Convert, Delete, Add activity) invalidate `['leads']`, `['leads', id]`, and `['leads', id, 'activities']` so list, detail, and activity tab stay in sync when the user navigates. No polling; refetch happens once per invalidation when the query is used.

### 10.6 Summary table

| Concern | Rule | Effect |
|--------|------|--------|
| Duplicate requests | Stable query keys; React Query dedupes | No double-fetch for same view |
| Search typing | Debounce 400 ms | Fewer requests, no jank |
| Page/filter change | `placeholderData: keepPreviousData` | No blank table flash |
| Detail/activities | `enabled: !!id` / `!!leadId` | No request on list page for detail data |
| Stats without API | Use list `total` only or “—” for others | No extra list request for stats |
| Refetch on focus | Optional `staleTime: 30_000` | Fewer refetches when switching tabs |
| Import large CSV | Prefer bulk endpoint or batched UI | No UI freeze, no request storm |
| Export all | Prefer server export or “current page” | No N-page fetch loop |
| 404 / errors | Return null; keep previous data on error | Correct UX, no crashes |

Implementing according to this section ensures the dynamic leads feature **works 100%** and **does not harm performance or speed**.
