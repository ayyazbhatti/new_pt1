# Plan: Terminal Settings — “Enable liquidation email” toggle

| Field | Value |
|-------|--------|
| **Status** | Draft — pending approval |
| **Scope** | Trading terminal Settings panel: one new toggle; backend respects it when sending liquidation email. |
| **Validated** | Yes — checked against deposits.rs, user_preferences.rs, SettingsPanel, terminal store, and preferences API. |

This plan was validated against the codebase: `create_liquidation_notifications_and_push` (deposits.rs) has `pool` and `user_id` and sends the email in a single block after Redis publish; `user_preferences.rs` uses a JSONB column and camelCase keys; SettingsPanel and terminal store follow the same pattern as the existing chart toggles. No migration is required.

---

## 1. Objective

In the **user trading terminal**, the **Settings** panel (opened via the settings button) already has a **Notifications** section. Add a **toggle: “Enable liquidation email”**.

- **When ON (default):** User continues to receive the liquidation HTML email when their position is liquidated (current behaviour).
- **When OFF:** User does **not** receive the liquidation email; they still receive the **in-app notification** (notification panel) and all other behaviour is unchanged.

The choice is persisted per user in the existing **user terminal preferences** (same store and API as chart options) and applied on the backend when sending the liquidation email.

---

## 2. Current behaviour (reference)

- **Terminal Settings panel:** `src/features/terminal/components/SettingsPanel.tsx` — toggles for chart options; each calls `updateTerminalPreferences({ chartShowAskPrice, chartShowPositionMarker, chartShowClosedPositionMarker })` via `PUT /api/user/terminal-preferences`, using `useTerminalStore.getState()` so all current keys are sent.
- **Backend:** `backend/auth-service/src/routes/user_preferences.rs` — `TerminalPreferences` has three bools; stored in `user_terminal_preferences` (user_id, preferences JSONB). Normalize/merge use camelCase. Table already exists; no migration needed for new keys.
- **Terminal store:** `terminalStore.ts` — same three flags with localStorage; `AppShellTerminal.tsx` loads via `getTerminalPreferences()` and sets the three setters.
- **Liquidation email:** In `deposits.rs`, `create_liquidation_notifications_and_push(pool, redis, inner_payload)` has `pool` and `user_id`; it inserts the notification, publishes to Redis, then sends the HTML email (lines ~1462–1502). No preference check today.

---

## 3. Implementation plan

### 3.1 Backend: add preference and respect it when sending liquidation email

**File:** `backend/auth-service/src/routes/user_preferences.rs`

- Add to `TerminalPreferences` struct: **`enable_liquidation_email: bool`** (default **true** so existing users keep receiving the email).
- In **`default_preferences()`:** set `enable_liquidation_email: true`.
- In **`normalize_preferences`:** read `enableLiquidationEmail` from JSON (camelCase); if missing, use default true.
- In **`merge_preferences`:** same for incoming; if key absent, keep existing (or default).

No new endpoint; GET/PUT will return and accept the new key. No DB migration.

**Helper for liquidation flow:** Add in `user_preferences.rs` a **public** function so default and JSON key live in one place: **`pub async fn get_enable_liquidation_email(pool: &PgPool, user_id: Uuid) -> bool`** — query `user_terminal_preferences` for that user; if no row or on error return `true`; else parse `preferences` (reuse `normalize_preferences`) and return `enable_liquidation_email`.

**File:** `backend/auth-service/src/routes/deposits.rs`

- Before the “Send HTML email to user” block: **query the user’s terminal preference** for “enable liquidation email”.
  - Call the helper above; if it returns false, skip the email block; if true, keep current behaviour.
- If the preference is **false**, **skip** the entire “Send HTML email to user” block (no email). Still insert the notification and publish to Redis so the in-app notification is unchanged.

The preference is **user-scoped** (the user who is liquidated), so we read it by that user’s id in the liquidation flow.

---

### 3.2 Frontend: terminal preferences type and API

**File:** `src/features/terminal/api/preferences.api.ts`

- Add to **`TerminalPreferences`** interface: **`enableLiquidationEmail: boolean`**.

No API signature change; the backend already returns and accepts partial JSON.

---

### 3.3 Frontend: terminal store

**File:** `src/features/terminal/store/terminalStore.ts`

- Add state: **`enableLiquidationEmail: boolean`** (default **true**).
- Add setter: **`setEnableLiquidationEmail: (value: boolean) => void`**.
- Optional: persist in localStorage (e.g. `terminal.enableLiquidationEmail`) for first-paint consistency, and overwrite when `getTerminalPreferences()` returns. Same pattern as the chart flags.
- In the initial state, set `enableLiquidationEmail: true`.

---

### 3.4 Frontend: load and save the new preference

**File:** `src/features/terminal/pages/AppShellTerminal.tsx`

- Where terminal preferences are loaded from the API (e.g. `getTerminalPreferences()`), set **`setEnableLiquidationEmail(res.preferences.enableLiquidationEmail ?? true)`** so the store reflects the server value after load.

**File:** `src/features/terminal/components/SettingsPanel.tsx`

- In the **Notifications** section, add a **toggle** row: label **“Enable liquidation email”**, description e.g. **“Receive an email when your position is liquidated”**.
- Use the same pattern as the chart toggles: read `enableLiquidationEmail` from the store, on toggle call `setEnableLiquidationEmail(checked)` and then `updateTerminalPreferences({ ... state, enableLiquidationEmail: checked })` (include all existing preference keys so the PUT merges correctly). On API failure, revert and show toast.

---

## 4. Data flow

1. User opens Terminal → Settings → sees “Enable liquidation email” toggle (default ON).
2. User turns it OFF → frontend updates store and calls `PUT /api/user/terminal-preferences` with `{ enableLiquidationEmail: false }` (and other keys). Backend merges into `user_terminal_preferences.preferences`.
3. Later, when the user is liquidated, `create_liquidation_notifications_and_push` runs. It inserts the notification and publishes to Redis (user still sees the in-app notification). Before sending the email, it reads the user’s `user_terminal_preferences` and sees `enableLiquidationEmail: false` → skips the email.
4. If the user has never changed the setting, no row or key exists → default true → email is sent (current behaviour).

---

## 5. Files to touch (checklist)

| Area | File(s) |
|------|--------|
| Backend | `user_preferences.rs`: add `enable_liquidation_email` (default true) to struct and normalize/merge; add public helper `get_enable_liquidation_email(pool, user_id)`. |
| Backend | `deposits.rs`: in `create_liquidation_notifications_and_push`, after Redis publish and before email block, call helper; if false, skip email block. |
| Frontend | `preferences.api.ts`: add `enableLiquidationEmail: boolean` to `TerminalPreferences`. |
| Frontend | `terminalStore.ts`: add `enableLiquidationEmail` state (default true) and `setEnableLiquidationEmail`; optional localStorage key for first paint. |
| Frontend | `AppShellTerminal.tsx`: when loading preferences, set `enableLiquidationEmail` from response. |
| Frontend | `SettingsPanel.tsx`: in Notifications section, add toggle “Enable liquidation email” wired to store and `updateTerminalPreferences`. |

---

## 6. Edge cases and guarantees

- **New user / no preferences row:** Default true → email sent (no change).
- **Key missing in JSON:** Normalize as true → email sent.
- **Frontend:** If API omits `enableLiquidationEmail`, use `?? true` when setting store so toggle defaults to ON.
- **Backend query or parse error:** Helper returns true so we do not suppress email on failure.

---

## 7. Summary

- **Setting:** One toggle in Terminal → Settings → Notifications: **“Enable liquidation email”** (default ON).
- **Persistence:** Stored in existing `user_terminal_preferences.preferences` (new key `enableLiquidationEmail`).
- **Backend:** When sending liquidation email, if user’s preference is false, skip the email; in-app notification and all other logic unchanged.
- **Frontend:** Add preference to type, store, load on shell init, and add toggle in SettingsPanel with save-on-change.

---

*Approval: _____________  Date: _____________*
