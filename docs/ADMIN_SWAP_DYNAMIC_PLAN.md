# Admin Swap Page — Dynamic Implementation Plan (Validated)

**Status:** Ready for implementation  
**Constraint:** No polling (no `refetchInterval`, no `setInterval`, no periodic refetch).  
**Data flow:** Fetch on load + refetch only after mutations via React Query invalidation.

---

## 1. Validation Summary

| Check | Result |
|-------|--------|
| Backend route pattern | Matches existing admin routes: `auth_middleware`, `check_admin`, `PgPool`, snake_case JSON. |
| Frontend API pattern | Matches `groups.api` / `markup.api`: `http()`, snake_case request body, camelCase response mapping. |
| React Query pattern | Matches `useGroups` / `useMarkup`: query keys, `invalidateQueries` on mutation success, no polling. |
| Types | Existing `SwapRule` in `src/features/swap/types/swap.ts` retained; payload types added for API. |
| Groups/Symbols for dropdowns | Real data: `useGroupsList()` (id/name), `listAdminSymbols()` (symbolCode, assetClass → market mapping). |
| Error handling | Same as other admin features: `error?.response?.data?.error?.message`, toast on mutation error. |

---

## 2. Backend Specification (auth-service)

### 2.1 Database

- **Table name:** `swap_rules`
- **Columns:**

| Column | Type | Nullable | Notes |
|--------|------|----------|--------|
| id | UUID | NO | PK, default `gen_random_uuid()` or `uuid_generate_v4()` |
| group_id | UUID | NO | FK → `user_groups(id)` |
| symbol | VARCHAR(64) | NO | e.g. `EURUSD`, `BTCUSDT` |
| market | VARCHAR(32) | NO | One of: `crypto`, `forex`, `commodities`, `indices`, `stocks` |
| calc_mode | VARCHAR(32) | NO | One of: `daily`, `hourly`, `funding_8h` |
| unit | VARCHAR(16) | NO | One of: `percent`, `fixed` |
| long_rate | NUMERIC(20,8) | NO | |
| short_rate | NUMERIC(20,8) | NO | |
| rollover_time_utc | VARCHAR(8) | NO | e.g. `00:00`, `23:59` (time only) |
| triple_day | VARCHAR(4) | YES | One of: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` |
| weekend_rule | VARCHAR(32) | NO | One of: `none`, `triple_day`, `fri_triple`, `custom` |
| min_charge | NUMERIC(20,8) | YES | |
| max_charge | NUMERIC(20,8) | YES | |
| status | VARCHAR(16) | NO | One of: `active`, `disabled` |
| notes | TEXT | YES | |
| created_at | TIMESTAMPTZ | NO | default `NOW()` |
| updated_at | TIMESTAMPTZ | NO | default `NOW()` |
| updated_by | VARCHAR(255) | YES | e.g. user id or email from JWT |

- **Constraints:** FK on `group_id`; optional unique `(group_id, symbol)` if one rule per group+symbol.
- **Delivery:** One migration file under `backend/auth-service/migrations/` (e.g. `YYYYMMDDHHMMSS_create_swap_rules.sql`) or equivalent schema application used by the project.

### 2.2 API Contract (REST, JSON)

Base path: **`/api/admin/swap`** (nest under this in `main.rs`).

- **GET /api/admin/swap/rules**  
  - **Query params (optional):** `group_id`, `market`, `symbol` (substring, case-insensitive), `status`, `calc_mode`, `page`, `page_size`.  
  - **Response 200:**  
    `{ "items": [ SwapRuleItem ], "page": 1, "page_size": 20, "total": N }`  
  - Each `SwapRuleItem` must include `group_name` (from join with `user_groups.name`). All other fields snake_case, e.g. `id`, `group_id`, `group_name`, `symbol`, `market`, `calc_mode`, `unit`, `long_rate`, `short_rate`, `rollover_time_utc`, `triple_day`, `weekend_rule`, `min_charge`, `max_charge`, `status`, `notes`, `updated_at`, `updated_by`.

- **GET /api/admin/swap/rules/:id**  
  - **Response 200:** Single object, same shape as list item.  
  - **Response 404:** `{ "error": { "code": "NOT_FOUND", "message": "..." } }`

- **POST /api/admin/swap/rules**  
  - **Body (snake_case):** `group_id`, `symbol`, `market`, `calc_mode`, `unit`, `long_rate`, `short_rate`, `rollover_time_utc`, `weekend_rule`, `status`; optional: `triple_day`, `min_charge`, `max_charge`, `notes`.  
  - **Response 201/200:** Created rule (same shape as list item).  
  - **Response 400:** Validation / business rule errors with `{ "error": { "code": "...", "message": "..." } }`.

- **PUT /api/admin/swap/rules/:id**  
  - **Body (snake_case):** Same fields as create; all optional for partial update.  
  - **Response 200:** Updated rule.  
  - **Response 404:** If rule does not exist.

- **DELETE /api/admin/swap/rules/:id**  
  - **Response 204** or **200** with no body.  
  - **Response 404:** If rule does not exist.

- **POST /api/admin/swap/rules/bulk** (optional)  
  - **Body:** `{ "group_id": "uuid", "symbol_codes": ["EURUSD", "GBPUSD"], "market": "forex", "calc_mode": "daily", ... }` — common fields plus list of symbols.  
  - **Response 200:** e.g. `{ "created": 2 }` or list of created rules.  
  - If not implemented in v1, frontend will use multiple `createSwapRule` calls and invalidate list once after all succeed.

All routes must sit behind existing admin auth middleware and return 403 when role ≠ admin. Error shape must be `{ "error": { "code": string, "message": string } }` so frontend can use `error?.response?.data?.error?.message`.

### 2.3 Backend Implementation Layout

- **New module:** `backend/auth-service/src/routes/admin_swap.rs`  
  - Handlers: `list_rules`, `get_rule`, `create_rule`, `update_rule`, `delete_rule`, optionally `bulk_create_rules`.  
  - Use `axum::extract::Query<HashMap<String, String>>` for list params; Path(Uuid) for id.  
  - Use same `ErrorResponse` / `ErrorDetail` pattern as `admin_markup.rs` / `admin_groups.rs`.

- **New service:** `backend/auth-service/src/services/admin_swap_service.rs`  
  - CRUD + list with filters; list query JOINs `user_groups` to select `user_groups.name AS group_name`.  
  - Validate enum values (market, calc_mode, unit, weekend_rule, status, triple_day) and FK `group_id` exists.

- **Registration in main.rs:**  
  - Add: `use routes::admin_swap::create_admin_swap_router;`  
  - Add: `.nest("/api/admin/swap", create_admin_swap_router(pool.clone()))`  
  - Ensure route order: more specific paths before parameterized (e.g. `/rules/bulk` before `/rules/:id` if both exist).

---

## 3. Frontend Specification

### 3.1 API Layer

- **New file:** `src/features/swap/api/swap.api.ts`
  - **listSwapRules(params?: ListSwapRulesParams):** GET `/api/admin/swap/rules`, build query string from params. Parse response: map each item with a `toCamelCaseRule(obj)` so that the rest of the app receives `SwapRule` (camelCase).
  - **getSwapRule(id: string):** GET `/api/admin/swap/rules/:id`, return camelCase `SwapRule`.
  - **createSwapRule(payload: CreateSwapRulePayload):** POST `/api/admin/swap/rules`, body = `toSnakeCase(payload)`, return camelCase `SwapRule`.
  - **updateSwapRule(id: string, payload: UpdateSwapRulePayload):** PUT `/api/admin/swap/rules/:id`, body = `toSnakeCase(payload)`, return camelCase `SwapRule`.
  - **deleteSwapRule(id: string):** DELETE `/api/admin/swap/rules/:id`. Handle 204 empty body (return void).
  - **bulkCreateSwapRules(payload: BulkCreateSwapRulesPayload):** POST `/api/admin/swap/rules/bulk` if backend implements it; otherwise not required in v1.

- **Snake/camel mapping:**  
  - Request: `groupId` → `group_id`, `calcMode` → `calc_mode`, `longRate` → `long_rate`, `shortRate` → `short_rate`, `rolloverTimeUtc` → `rollover_time_utc`, `tripleDay` → `triple_day`, `weekendRule` → `weekend_rule`, `minCharge` → `min_charge`, `maxCharge` → `max_charge`, `updatedAt`/`updatedBy` as sent by backend.  
  - Response: map all snake_case keys to camelCase so existing `SwapRule` interface is satisfied (including `groupName` from `group_name`).

### 3.2 Types

- **Existing:** Keep `SwapRule`, `SwapPreviewInput`, `SwapPreviewResult` in `src/features/swap/types/swap.ts`.
- **Add:**
  - `ListSwapRulesParams`: `{ groupId?: string; market?: string; symbol?: string; status?: string; calcMode?: string; page?: number; pageSize?: number }`
  - `CreateSwapRulePayload`: Omit<SwapRule, 'id' | 'groupName' | 'updatedAt' | 'updatedBy'> & { groupId: string } (and optional fields as needed).
  - `UpdateSwapRulePayload`: Partial<CreateSwapRulePayload> (at least status, rates, schedule fields).
  - `BulkCreateSwapRulesPayload` (if bulk): `{ groupId: string; symbolCodes: string[]; market: string; calcMode: SwapCalcMode; ... }`.

### 3.3 React Query Hooks

- **New file:** `src/features/swap/hooks/useSwapRules.ts`
  - **Query key factory:**  
    `swapRulesKeys = { all: ['swapRules'], lists: () => [...all, 'list'], list: (params?) => [...lists(), params], detail: (id) => [...all, 'detail', id] }`
  - **useSwapRulesList(params?):** `useQuery({ queryKey: swapRulesKeys.list(params), queryFn: () => listSwapRules(params), enabled: true })`. No `refetchInterval`. Optional: `staleTime` per project norms.
  - **useSwapRule(id):** `useQuery({ queryKey: swapRulesKeys.detail(id), queryFn: () => getSwapRule(id), enabled: !!id })`. Used if edit modal needs fresh single rule; otherwise list item is enough.
  - **useCreateSwapRule():** `useMutation({ mutationFn: createSwapRule, onSuccess: () => queryClient.invalidateQueries({ queryKey: swapRulesKeys.lists() }), onError: (e) => toast.error(e?.response?.data?.error?.message || 'Failed to create') })`, and toast.success on success.
  - **useUpdateSwapRule():** Same pattern; onSuccess invalidate `swapRulesKeys.lists()` and `swapRulesKeys.detail(variables.id)`.
  - **useDeleteSwapRule():** Same; onSuccess invalidate `swapRulesKeys.lists()`.
  - **useBulkCreateSwapRules():** Only if backend exposes bulk; otherwise use a loop of `createSwapRule` and single invalidation after all succeed.

### 3.4 Page and Components (Wiring)

- **SwapRulesPage**
  - Use `useSwapRulesList(filters)` where `filters` is the current filter state (from SwapFiltersBar). Pass `data?.items ?? []` to `SwapRulesTable`. Handle `isLoading` (skeleton/spinner) and `error` (message + optional retry). Remove any use of `mockSwapRules` for the main table.

- **SwapFiltersBar**
  - Keep local state; on change call parent `setFilters` so list query uses new params. If list API supports server-side filters (recommended), pass `filters` as `ListSwapRulesParams` (groupId, market, symbol, status, calcMode) so list is fetched with query params.

- **SwapRulesTable**
  - Receive `rules` from parent (from API). Disable/Enable button: call `updateSwapRule(rule.id, { ...rule, status: rule.status === 'active' ? 'disabled' : 'active' })` via `useUpdateSwapRule()`; onSuccess table updates from refetched list. Delete: ConfirmDeleteModal calls `deleteSwapRule(rule.id)`; onSuccess close modal and list refetches.

- **CreateSwapRuleModal**
  - Use `useCreateSwapRule()`. On submit: build payload from form, call `createSwapRule(payload)`; onSuccess close modal (list invalidated, refetches). Use **useGroupsList()** for group dropdown (real data). For symbols: use **listAdminSymbols()** (or existing symbols hook); map `assetClass` to swap `market` (e.g. FX→forex, Crypto→crypto, Metals/Commodities→commodities, Indices→indices, Stocks→stocks) and filter symbols by selected market.

- **EditSwapRuleModal**
  - Use `useUpdateSwapRule()`. On submit: `updateSwapRule(rule.id, payload)`; onSuccess close modal. Prefill from `rule` prop (current row from list).

- **ConfirmDeleteModal**
  - Use `useDeleteSwapRule()`. On confirm: `deleteSwapRule(rule.id)`; onSuccess close modal.

- **BulkAssignSwapModal**
  - If backend has bulk: call `bulkCreateSwapRules({ groupId, symbolCodes, ... })` and invalidate list on success. If no bulk: loop `createSwapRule` for each selected symbol, then invalidate list once; show progress or toast per batch if desired.

- **PreviewSwapModal**
  - No API change; keep client-side `computeSwapPreview(rule, input)`.

### 3.5 Groups and Symbols

- **Groups:** Use `useGroupsList()` (or equivalent) in Create/Edit/Bulk modals; options = `data?.items ?? []` with `id` and `name`. No `mockGroups`.
- **Symbols:** Use `listAdminSymbols()` (or existing admin symbols hook). For Create/Edit/Bulk, filter by market; map `assetClass` to swap `market` where needed (FX→forex, etc.). Remove dependency on `swapSymbols` mock for option lists.

---

## 4. Implementation Order

1. **Backend**
   - Create migration (or schema script) for `swap_rules`.
   - Implement `admin_swap_service.rs` (list with JOIN for group_name, get, create, update, delete; optional bulk).
   - Implement `admin_swap.rs` routes and register in `main.rs`.
   - Smoke-test with curl/Postman (list, create, update, delete).

2. **Frontend – data**
   - Add `ListSwapRulesParams`, `CreateSwapRulePayload`, `UpdateSwapRulePayload` in types.
   - Implement `swap.api.ts` with snake_case ↔ camelCase and `http()`.
   - Implement `useSwapRules.ts` (list + create/update/delete mutations, invalidation, toasts).

3. **Frontend – UI**
   - SwapRulesPage: `useSwapRulesList(filters)`, loading/error, pass `rules` to table.
   - CreateSwapRuleModal: `useCreateSwapRule()`, real groups and symbols.
   - EditSwapRuleModal: `useUpdateSwapRule()`.
   - ConfirmDeleteModal: `useDeleteSwapRule()`.
   - SwapRulesTable: Disable/Enable via `useUpdateSwapRule()` for status.
   - BulkAssignSwapModal: bulk or loop create + one invalidation.
   - SwapFiltersBar: pass filters to list query (and to API as query params if supported).

4. **Cleanup**
   - Remove or confine `mockSwapRules` to tests only; ensure no production code path uses it for the main table.

---

## 5. No-Polling Guarantee

- No `refetchInterval` on any swap rules query.
- No `setInterval` or periodic `refetch()` in `useEffect`.
- List updates only when: (1) user opens or re-focuses the page (React Query default refetch-on-window-focus is acceptable and is not “polling”), or (2) after a mutation (create/update/delete/bulk) via `invalidateQueries`, which triggers a single refetch. Optional: disable refetchOnWindowFocus for this query if product requirement is “only update after my actions.”

---

## 6. Sign-off

This plan is aligned with the existing codebase patterns (auth-service admin routes, frontend `http()` + React Query, error shape, types). Implementation following this document will produce a fully dynamic Admin Swap page with no polling and reliable list updates after every mutation.
