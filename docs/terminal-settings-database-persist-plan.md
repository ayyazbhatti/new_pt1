# Plan: Persist User Trading Terminal Settings in Database

**Status:** Draft for approval  
**Scope:** Move terminal Settings panel toggles from browser localStorage to database per user.

---

## Guarantees (performance, reliability, no regression)

Before implementation details, this section states how the plan ensures **no speed impact**, **reliable behavior**, and **no disturbance to existing functionality**.

### No impact on speed or optimization

- **Single GET per terminal session** — Preferences are fetched **once** when the user opens the trading terminal (e.g. when `AppShellTerminal` mounts). There is no GET on every Settings panel open, no polling, and no extra requests on chart/trading actions.
- **PUT only on user action** — A PUT runs **only** when the user toggles one of the three switches. No background sync, no timers, no extra traffic.
- **First paint stays instant** — The store is still initialized from **localStorage** first (same as today). The UI renders immediately with last-known values. The GET runs in the background and overwrites the three keys when the response arrives. Chart and trading flows are **not** blocked or delayed.
- **Backend cost** — One small table; one row per user; simple primary-key lookup (GET) and single-row upsert (PUT). No joins, no heavy queries. No change to existing endpoints or middleware order.
- **No change to hot paths** — Order placement, position updates, balance/account summary, WebSocket handling, and chart rendering continue to use the same code and the same store fields. Preferences are read from the same three booleans in the store as today; only the **source** of initial/updated values is extended (API + localStorage).

### 100% reliable behavior

- **GET failure** — If the GET request fails (network, 5xx, or 401), the frontend **does not** break. The store keeps the values it already has (from localStorage or defaults). Optionally a non-blocking toast can say "Could not load settings"; the user can keep using the terminal and toggles.
- **PUT failure** — If the PUT fails, the store **reverts** to the previous value for that toggle and a toast explains that save failed. The user sees a consistent state and can try again.
- **No row yet** — If the user has never saved preferences, the backend returns **defaults** (all `true`) without writing to the DB. No errors, no missing data.
- **Invalid data** — If the DB returns partial or invalid JSON, the backend normalizes to a full object with defaults. The frontend always receives a valid `preferences` object with the three keys.
- **Backend errors** — Invalid PUT body returns `400` and leaves the row unchanged. Auth failures return `401`. No panics, no 500s from this feature when used as specified.

### No disturbance to existing functionality

- **Additive only** — New database table, new route module, new API file. **No removal or replacement** of existing routes, store fields, or components. Existing behavior is preserved.
- **Same store shape** — The terminal store keeps the same three boolean flags (`chartShowAskPrice`, `chartShowPositionMarker`, `chartShowClosedPositionMarker`) and the same setters. Chart components and Settings panel keep reading/writing these fields exactly as they do today. We only add **where** the initial values come from (GET) and **where** changes are persisted (PUT + optional localStorage write).
- **localStorage unchanged for others** — We do **not** remove or repurpose `terminal.selectedSymbolId` or any other localStorage key. Only the three chart-preference keys are optionally written back to localStorage as a cache after a successful PUT. Reading from localStorage for first paint remains optional and does not affect other features.
- **No changes to** — Order placement, position close, balance fetch, account summary, WebSocket subscriptions, notifications, payments, chat, or any other terminal or app feature. They are untouched.
- **Rollback-safe** — If the new code is reverted, the app works as before: the store still initializes from localStorage (existing code path). The new GET/PUT are simply not called; no broken references if the feature is removed.

These guarantees are binding for implementation: any code change that would violate them (e.g. blocking first paint on GET, or modifying order/position logic) is out of scope.

---

## 1. Summary

The **trading terminal settings** (chart options in the left sidebar **Settings** panel) are currently stored only in **browser localStorage**. This plan persists them in the **database** per user so settings are the same across devices and browsers. Implementation is limited to the three existing toggles; the same mechanism can be extended later for more options.

---

## 2. Scope: Settings in Scope

Only the **three existing toggles** in the Settings panel are persisted to the DB:

| Setting | Store key | Type | Default |
|--------|------------|------|--------|
| Show ask price line | `chartShowAskPrice` | boolean | `true` |
| Show position open marker | `chartShowPositionMarker` | boolean | `true` |
| Show closed position marker | `chartShowClosedPositionMarker` | boolean | `true` |

**Explicitly out of scope**

- **Selected symbol** (`terminal.selectedSymbolId`) — remains in localStorage (per-device).
- **Future options** (Theme, Density, Notifications, Price format, Time zone) — same table/API can be extended later when those toggles exist.

---

## 3. Backend (auth-service)

### 3.1 Database: new table

- **Table name:** `user_terminal_preferences`
- **Semantics:** One row per user; `user_id` is the primary key. Preferences stored in a single **JSONB** column so new keys can be added without further migrations.
- **Referential integrity:** `user_id` references `users(id) ON DELETE CASCADE` so preferences are removed when the user is deleted.

**Migration file**

- **Path:** `backend/auth-service/migrations/YYYYMMDDHHMMSS_create_user_terminal_preferences.sql`
- **Naming:** Match existing pattern (e.g. `20260219100000_create_swap_rules.sql`). Use a timestamp for your migration date.
- **Execution:** Run via `sqlx migrate run` (or your existing migration process). The codebase currently does not run migrations from `main.rs`; they are run separately (e.g. sqlx-cli).

**SQL**

```sql
-- Per-user trading terminal UI preferences (chart options, etc.)
CREATE TABLE user_terminal_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_terminal_preferences IS 'Per-user trading terminal UI preferences (chart options, etc.).';
```

No separate index on `user_id` is needed; the primary key already provides it.

**Example row (preferences JSON)**

```json
{
  "chartShowAskPrice": true,
  "chartShowPositionMarker": true,
  "chartShowClosedPositionMarker": false
}
```

### 3.2 API: endpoints and contract

**Base path (fixed):** `/api/user/terminal-preferences`

**Auth**

- Both endpoints require a valid **JWT** (same as other user APIs).
- `user_id` is taken **only** from the token (`Claims.sub`). No `user_id` in path or body.
- Use existing `auth_middleware` and `Extension(Claims)`; handler uses `claims.sub` as `user_id`.

**GET `/api/user/terminal-preferences`**

- **Response:** `200 OK`  
  Body: `{ "preferences": { "chartShowAskPrice": boolean, "chartShowPositionMarker": boolean, "chartShowClosedPositionMarker": boolean } }`
- **Logic:**
  - If a row exists for `user_id`, return its `preferences` JSON, normalizing the three keys (missing key → default `true`).
  - If no row exists, return the **defaults** object (all three `true`) and **do not** insert a row. The first PUT will create the row.
- **Errors:** `401` if not authenticated (handled by middleware).

**PUT `/api/user/terminal-preferences`**

- **Request body:** `{ "preferences": { "chartShowAskPrice"?: boolean, "chartShowPositionMarker"?: boolean, "chartShowClosedPositionMarker"?: boolean } }`  
  All keys optional; only provided keys are updated.
- **Response:** `200 OK`  
  Body: same shape as GET (current full preferences after merge).
- **Logic:**
  - Merge request `preferences` into existing JSONB (only the three known keys; ignore unknown keys). Use PostgreSQL `jsonb ||` (concat/merge) or equivalent: existing row's JSONB merged with incoming object, then `updated_at = NOW()`.
  - If no row exists: **INSERT** a new row with merged preferences (defaults for any missing key).
  - If row exists: **UPDATE** the row with merged preferences and `updated_at = NOW()`.
- **Implementation option:** Use `INSERT INTO user_terminal_preferences (user_id, preferences, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET preferences = user_terminal_preferences.preferences || EXCLUDED.preferences, updated_at = NOW()` with the incoming preferences (and defaults for the three keys so the merged result is complete).
- **Errors:** `400` if body is invalid (e.g. not an object); `401` if not authenticated.

**Response shape (GET and PUT)**

```json
{
  "preferences": {
    "chartShowAskPrice": true,
    "chartShowPositionMarker": true,
    "chartShowClosedPositionMarker": false
  }
}
```

### 3.3 Backend implementation details

- **New module:** `backend/auth-service/src/routes/user_preferences.rs` (dedicated router for user-scoped preferences).
- **Router:** Create a router with two routes: `get_terminal_preferences` (GET) and `put_terminal_preferences` (PUT). Attach `auth_middleware` and use `State(pool)` and `Extension(Claims)`; use `claims.sub` as `user_id`.
- **Registration:** In `main.rs`, mount the router at `/api/user` (e.g. `.nest("/api/user", create_user_preferences_router(pool.clone()))`). So full paths are `GET /api/user/terminal-preferences` and `PUT /api/user/terminal-preferences`.
- **Serialization:** Use `serde` with `rename_all = "camelCase"` for the response so the frontend receives camelCase keys without change.
- **Defaults:** Define a single constant (e.g. default preferences map or struct) and use it for GET when no row exists and for merging on PUT when a key is missing.

---

## 4. Frontend

### 4.1 API client

- **File:** `src/features/terminal/api/preferences.api.ts` (or `src/shared/api/terminalPreferences.api.ts`).
- **HTTP client:** Use the existing `http<T>()` from `@/shared/api/http` (or equivalent). It already attaches the Bearer token; no extra auth wiring.
- **Types:**

```ts
export interface TerminalPreferences {
  chartShowAskPrice: boolean
  chartShowPositionMarker: boolean
  chartShowClosedPositionMarker: boolean
}

export interface TerminalPreferencesResponse {
  preferences: TerminalPreferences
}
```

- **Functions:**
  - `getTerminalPreferences(): Promise<TerminalPreferencesResponse>` — `GET /api/user/terminal-preferences`.
  - `updateTerminalPreferences(preferences: Partial<TerminalPreferences>): Promise<TerminalPreferencesResponse>` — `PUT /api/user/terminal-preferences` with body `{ preferences }`.
- **Errors:** Let the `http()` layer throw on non-2xx; caller (store or component) handles and optionally shows a toast.

### 4.2 When to load preferences

- **Trigger:** When the user is logged in **and** the trading terminal is used (e.g. when `AppShellTerminal` mounts).
- **Flow:**
  1. **Do not block render** — The store must already be initialized from localStorage (or defaults) so the terminal and chart render immediately. Then, in the same mount flow, call `getTerminalPreferences()` **asynchronously** (e.g. in a `useEffect` or after first paint). When the response arrives, overwrite the three keys in the store. No `await` of GET before rendering the terminal.
  2. On success: set the three flags in the terminal store from `response.preferences` (use defaults for any missing key).
  3. On failure (network or 4xx/5xx): **do not** throw or leave the app in a broken state. Keep the current store values (from localStorage or defaults); optionally show a non-blocking toast (e.g. "Could not load settings"). The user continues with last-known or default preferences.
- **Strict: one GET per session** — Use a single load per terminal session (e.g. in `AppShellTerminal` or a small hook that runs when `user?.id` is set and terminal is active). Do **not** call GET on every Settings panel open, and do **not** call GET from chart or trading code.

### 4.3 When to save preferences

- **Trigger:** When the user toggles any of the three switches in the Settings panel.
- **Flow:**
  1. Update the **terminal store immediately** (optimistic UI) so the chart/UI reflects the new value without waiting for the server.
  2. Call `updateTerminalPreferences` with the **full** current preferences from the store (so the server always has a complete picture).
  3. On success: optionally sync the same values to **localStorage**; no need to change store again.
  4. On failure: **revert** the store to the previous value for that toggle and show a toast (e.g. "Failed to save settings. Please try again."). **Required:** the UI must show the reverted state; the user must not be left with a toggle that says "on" while the store is out of sync.
- **Debounce (optional):** If desired, debounce PUT by 300–500 ms to avoid multiple rapid requests; for three toggles this is optional. If not debouncing, each toggle still triggers exactly one PUT.

### 4.4 localStorage: cache only

- **On load:** Initialize store from **localStorage** first (so the UI does not flash), then run GET and **overwrite** the three keys in the store with the server response. This way the first paint uses last-known values; after the request, the server is the source of truth.
- **On save:** After a successful PUT, write the same three keys to localStorage so that the next page load can show them before the GET response arrives.
- **Conflict:** If GET fails, keep the localStorage-backed store values; user continues with last known state.

### 4.5 Store and Settings panel changes

- **Terminal store (`terminalStore.ts`):**
  - Keep the three boolean flags and their setters.
  - Add a one-time load of preferences when the terminal is used (e.g. from `AppShellTerminal` or a hook that calls `getTerminalPreferences` and then `setChartShowAskPrice`, etc.). Initial state can still be read from localStorage until GET returns.
  - In each setter (or in the Settings panel), after updating state, call `updateTerminalPreferences` with the full preferences; on failure, revert and toast.
- **Settings panel:** No change to the UI layout; only wire the existing switches to the same store and ensure the store triggers the PUT and error handling above.

---

## 5. Data flow (end-to-end)

1. User opens trading terminal → frontend loads from localStorage (instant), then GET → store overwritten with server preferences (or defaults if no row).
2. User toggles a setting → store updates → PUT with full preferences → on success optionally update localStorage; on failure revert store and show toast.
3. User on another device/browser → GET returns the same preferences → same experience.

---

## 6. Backward compatibility and edge cases

- **Existing users with no row:** GET returns defaults (all `true`). First PUT creates the row. No migration of existing localStorage data is required; first GET/PUT cycle brings them into the DB.
- **Old frontend (localStorage-only):** Continues to work; no DB row until the new client runs and calls PUT. No conflict.
- **Invalid or partial JSON from DB:** When reading the row, normalize the three keys with defaults so the response is always a complete object.
- **PUT with empty body or invalid JSON:** Return `400` and do not change the row.

---

## 7. Security and performance

- **Auth:** Only the authenticated user can read/write their own row; `user_id` is always from JWT (`claims.sub`), never from request body or path.
- **Size:** One small JSONB object per user; no pagination. No extra index beyond the primary key.
- **Rate limiting:** Optional; if desired, debounce PUT on the frontend (e.g. 300–500 ms) to limit request rate per user.

---

## 8. Files to add or change (checklist)

Implementation **must** follow the **Guarantees** section above (no blocking, single GET per session, revert on PUT failure, additive-only changes).

| # | Layer | Action |
|---|--------|--------|
| 1 | Backend | Add migration `*_create_user_terminal_preferences.sql` with table and comment. |
| 2 | Backend | Add `routes/user_preferences.rs`: GET and PUT handlers, auth, merge/upsert logic. |
| 3 | Backend | In `routes/mod.rs`, add `pub mod user_preferences;`. |
| 4 | Backend | In `main.rs`, nest the new router at `/api/user` with auth. |
| 5 | Frontend | Add `terminal/api/preferences.api.ts` (or shared): types, `getTerminalPreferences`, `updateTerminalPreferences`. |
| 6 | Frontend | Terminal store: trigger GET **asynchronously** on terminal load (user present); **do not** block first paint. Apply response to store on success; on failure keep current store values. On toggle: update store, then PUT; on PUT failure **revert** store and show toast. |
| 7 | Frontend | Optional: keep localStorage as cache (initialize store from it, then overwrite from GET; on successful PUT, write back to localStorage). |

---

## 9. Why this will work

- **Backend:** Same auth and routing patterns as existing user-scoped endpoints (e.g. deposits, notifications). Single table, simple GET/PUT with merge; no complex queries. Migration is additive and CASCADE keeps referential integrity.
- **Frontend:** Same `http()` and auth as rest of app; no new auth flow. Store already has the three flags and setters; we only add one GET on load and one PUT on change, with clear error handling and optional localStorage cache.
- **Compatibility:** No row means defaults; first PUT creates the row. Old clients keep using localStorage until updated. No breaking change to existing behavior.

---

## 10. Verification after implementation

1. **Run migration** — Table `user_terminal_preferences` exists; no errors.
2. **GET with no row** — Call GET as authenticated user who has never saved; response is defaults (all `true`).
3. **PUT creates row** — Call PUT with one key changed; then GET returns that value; DB has one row for that user.
4. **PUT merges** — Change another key via PUT; GET returns both changes; single row updated.
5. **Frontend load** — Open terminal; GET runs once; store shows server values (or defaults). **Confirm:** Terminal and chart render immediately (no visible delay); GET does not block first paint.
6. **Frontend save** — Toggle a switch; PUT runs; reload page; GET runs; same value persists.
7. **Cross-device** — Same user, different browser/device; GET returns same preferences.
8. **Failure path** — Disconnect network, toggle switch; store reverts and toast appears.
9. **No regression** — Place an order, open/close a position, check balance and account summary, receive a notification. Confirm that all existing terminal and app behavior works as before and that there is no perceptible slowdown.

---

## 11. Approval and next steps

Once this plan is approved, implementation order will be:

1. Add and run the migration.
2. Implement backend router and register it.
3. Add frontend API and wire store + Settings panel (load on terminal open **without blocking render**, save on toggle with **revert + toast on failure**, optional localStorage cache). All changes must remain **additive** and must **not** modify order, position, balance, or chart logic.
4. Run through the verification steps above and confirm that existing terminal behavior (trading, chart, balance, notifications) is unchanged.
