# Voiso telephony / omnichannel — integration guide (self-contained)

This document describes how **Voiso** is integrated in this platform so another team can reproduce the same behavior in a different codebase. It is derived only from the implementation in this repository (read-only audit).

**Files read (primary sources):**  
`backend/auth-service/src/routes/admin_voiso.rs`, `backend/auth-service/src/routes/admin_settings.rs`, `backend/auth-service/src/routes/admin_call_records.rs`, `backend/auth-service/src/services/call_record_handler.rs`, `backend/auth-service/src/lib.rs`, `backend/ws-gateway/src/ws/session.rs`, `infra/migrations/053_platform_voiso_config.sql`, `infra/migrations/018_admin_call_records.sql`, `infra/migrations/021_missing_permissions.sql`, `src/features/adminVoiso/pages/AdminVoisoPage.tsx`, `src/features/adminVoiso/api/voiso.api.ts`, `src/features/settings/components/VoisoSettingsTab.tsx`, `src/features/settings/api/voisoConfig.api.ts`, `src/features/settings/pages/SettingsPage.tsx`, `src/features/adminCalls/api/callRecords.api.ts`, `src/features/adminCalls/pages/AdminCallUserPage.tsx` (partial), `src/app/router/adminRoutes.tsx`, `src/app/config/nav.ts`, `deploy/docker-compose.prod.yml`, `deploy/.env.production.example`, `.env.example`.

---

## 1. What Voiso is (in this app)

**Voiso** is a hosted **contact-center / omnichannel** product. In this codebase it is used for:

- **Embedded agent workspace:** an **iframe** loads Voiso’s **omnichannel embedded** URL so admins can use Voiso’s web UI (softphone, queues, etc.) inside the app.
- **Click-to-call (PSTN):** the **auth-service** proxies **HTTP requests** to Voiso’s **Click2Call** APIs so the **API key never reaches the browser**. The admin enters a **Voiso agent extension** and a **destination E.164 number**; the backend calls Voiso, which rings the agent’s Voiso-connected device first (UX copy: “The agent’s phone should ring”).

**URLs and API patterns used in code (defaults cluster `cc-ams03`):**

| Purpose | Default / pattern in code |
|--------|---------------------------|
| Embedded panel (iframe `src`) | `https://cc-ams03.voiso.com/omnichannel/embedded` (configurable via DB + build-time env) |
| “Full panel” link (strip `/omnichannel/embedded`) | `https://cc-ams03.voiso.com/` |
| Legacy Click2Call | `POST {click2call_base}/{apiKey}/click2call` with `application/x-www-form-urlencoded` body `agent`, `number` |
| Newer Click2Call (Bearer) | `POST {cluster_origin}/api/v4/click2call` or `POST {cluster_origin}/api/v4/calls/click2call` with **Bearer** token = API key, JSON body |
| User lookup (extension → Voiso user id) | `GET {cluster_origin}/api/v4/users` with **Bearer** token |
| Voice outbound (fallback path) | `POST {cluster_origin}/api/v4/voice/calls` with JSON `user_id`, `phone_number`, `caller_id` |

**Integration style:** **both** — **hosted iframe** for the panel and **server-side REST** for Click2Call.  
**UNCERTAIN:** Official Voiso signup URL, exact product naming per Voiso docs, and whether your tenant uses `v1` key-in-path or `v4` Bearer-only (this app tries **legacy first**, then **v4**).

---

## 2. Credentials & account setup (prerequisites)

From the implementation, you need:

| Item | Used for |
|------|----------|
| **Voiso API key** | Click2Call and `GET /api/v4/users` (Bearer). Stored in **Postgres** (`platform_voiso_config.api_key`) and/or **server env** `VOISO_API_KEY`. |
| **Click2Call base URL** | Usually `https://<your-cluster>.voiso.com/api/v1` (stored in DB). Backend derives **cluster origin** by stripping at first `/api/` for v4 calls. |
| **Embedded panel URL** | Must be the **`/omnichannel/embedded`** path on your cluster so Voiso allows **iframe** embedding (stored in DB; frontend also has build-time `VITE_VOISO_PANEL_URL`). |
| **Agent extension** | String such as `1007` — must match a user in Voiso’s **Users** list (matched against `extension`, `sip_account`, or `sag` fields in the JSON returned by `GET /api/v4/users`). |
| **Destination number** | **E.164 digits without `+`** (e.g. `393511775043`). |

**Per-agent / per-user mapping in this app:**  
- **Click2Call:** only the **extension string** is sent to Voiso; mapping extension → Voiso `user_id` for the **voice** fallback is done by **fetching all users** from Voiso and matching locally (`admin_voiso.rs`, `resolve_voiso_user_id_by_extension`).  
- **No** stored mapping table in Postgres for Voiso user IDs.

**Whitelisting / CORS / iframe:**  
- The UI explicitly tells operators to use the **`/omnichannel/embedded`** URL for iframe compatibility (`VoisoSettingsTab.tsx`).  
- **UNCERTAIN:** Exact Voiso admin steps for domain allowlists; not encoded in this repo beyond comments and defaults.

**Where to get credentials:**  
- Comments reference “Voiso dashboard” / “Voiso API key” (`VoisoSettingsTab.tsx`, `deploy/.env.production.example`). **UNCERTAIN:** Exact Voiso admin URL for your region/cluster.

---

## 3. Environment variables

| Name | Purpose | Example | Consumed by | File path |
|------|---------|---------|-------------|-----------|
| `VOISO_API_KEY` | Fallback API key when DB `api_key` is empty | `YOUR_VOISO_API_KEY` | **Backend** (auth-service) | `backend/auth-service/src/routes/admin_voiso.rs` (`.or_else(|| std::env::var("VOISO_API_KEY"))`), `admin_settings.rs` (flags `envApiKeyConfigured` only) |
| `VOISO_CLICK2CALL_URL` | Fallback Click2Call base when DB `click2call_url` is empty | `https://cc-ams03.voiso.com/api/v1` | **Backend** | `admin_voiso.rs` (`.or_else(|| std::env::var("VOISO_CLICK2CALL_URL").ok())`) — **not** listed in `deploy/.env.production.example` but present in code |
| `VITE_VOISO_PANEL_URL` | **Build-time** default embedded panel URL for frontend when API/config unavailable | `https://cc-ams03.voiso.com/omnichannel/embedded` | **Frontend** (Vite) | `src/features/adminVoiso/pages/AdminVoisoPage.tsx` (`import.meta.env.VITE_VOISO_PANEL_URL`), `deploy/docker-compose.prod.yml` (`args`), `.env.example` |

**No other Voiso-specific env vars** were found by repository search.

---

## 4. Database schema

### 4.1 `platform_voiso_config`

**Migration:** `infra/migrations/053_platform_voiso_config.sql`

| Column | Type | Null | Default | Meaning |
|--------|------|------|---------|--------|
| `singleton_id` | `SMALLINT` | NOT NULL | `1` | **Single global row**; `PRIMARY KEY` with `CHECK (singleton_id = 1)`. |
| `api_key` | `TEXT` | YES | — | Voiso API key **at rest — plaintext** (not hashed/encrypted in schema). **Never returned** by GET settings API (only booleans). |
| `click2call_url` | `TEXT` | NOT NULL | `https://cc-ams03.voiso.com/api/v1` | Base URL for legacy path + derivation of cluster origin. |
| `panel_url` | `TEXT` | NOT NULL | `https://cc-ams03.voiso.com/omnichannel/embedded` | iframe `src` for embedded panel (also returned in a reduced form via `/api/admin/voiso/config`). |
| `enabled` | `BOOLEAN` | NOT NULL | `true` | When `false`, Click2Call returns **503** with `CONFIG` / “integration is disabled”. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Audit. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Audit. |

**Row count:** exactly one logical row (`singleton_id = 1`); insert uses `ON CONFLICT DO NOTHING`.

### 4.2 `admin_call_records`

**Migration:** `infra/migrations/018_admin_call_records.sql`  
**Purpose:** **In-app admin ↔ user WebRTC call** lifecycle (via **ws-gateway** + **NATS**), **not** Voiso PSTN callbacks. Voiso Click2Call does **not** insert rows here in the audited code.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | Internal row id. |
| `call_id` | `UUID` UNIQUE | Correlates with WebRTC signaling `call_id` from ws-gateway. |
| `admin_user_id` | `UUID` FK → `users` | Admin who initiated. |
| `user_id` | `UUID` FK → `users` | Target user. |
| `status` | `TEXT` default `'initiated'` | Handler inserts **`ringing`** on NATS `event: "initiated"` (see §7). |
| `initiated_at`, `answered_at`, `ended_at` | `TIMESTAMPTZ` | Timestamps. |
| `duration_seconds` | `INTEGER` | Set on end/timeout from SQL `EXTRACT(EPOCH ...)`. |
| `ended_by` | `TEXT` | e.g. `admin`, `user`, `timeout`. |
| `admin_display_name` | `TEXT` | From NATS payload on initiate. |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | Audit. |

**Population:** `backend/auth-service/src/services/call_record_handler.rs` on **`admin_call.events`** NATS messages published by **`backend/ws-gateway/src/ws/session.rs`**.

### 4.3 Other Voiso-related tables

Grep of `infra/migrations` for `voiso` / `telephony` / `call`: only **`platform_voiso_config`**, **`admin_call_records`**, and **permission** seeds (`call:view` in `021_missing_permissions.sql`). No separate Voiso webhook table.

---

## 5. Backend — configuration endpoints (Settings → Voiso)

Router mount: **`/api/admin/settings`** + route **`/voiso`** → full paths **`GET /api/admin/settings/voiso`** and **`PUT /api/admin/settings/voiso`**.  
**Handler file:** `backend/auth-service/src/routes/admin_settings.rs` (`get_voiso_config`, `put_voiso_config`).  
**Auth:** `auth_middleware` on router (JWT).  
**Permissions:** `check_settings_permission(..., "settings:view")` for GET; **`settings:edit`** for PUT.

### `GET /api/admin/settings/voiso`

**Response JSON (exact keys from code):**

```json
{
  "apiKeyConfigured": true,
  "storedApiKeyConfigured": true,
  "envApiKeyConfigured": false,
  "click2callUrl": "https://cc-ams03.voiso.com/api/v1",
  "panelUrl": "https://cc-ams03.voiso.com/omnichannel/embedded",
  "enabled": true
}
```

- **`apiKeyConfigured`:** `true` if DB has non-empty `api_key` **or** `VOISO_API_KEY` env is set.  
- **`storedApiKeyConfigured`:** DB only.  
- **`envApiKeyConfigured`:** env only.  
- **Secret:** raw API key is **never** included in the response.

### `PUT /api/admin/settings/voiso`

**Request body (`PutVoisoConfigBody`, camelCase):**

| Field | Type | Semantics |
|-------|------|-----------|
| `apiKey` | optional string | **Omitted** = leave DB key unchanged. **Empty string** = set `api_key` to `NULL`. **Non-empty** = replace stored key. |
| `click2callUrl` | string | Required non-empty; must start with `http://` or `https://`. |
| `panelUrl` | string | Same validation. |
| `enabled` | boolean | Stored as-is. |

**Response:** same shape as GET (re-fetched via `get_voiso_config` after update).

**Validation errors:** HTTP **400** with `{ "error": { "code": "VALIDATION", "message": "..." } }`.

**No dedicated “test Voiso” endpoint** exists in this codebase (no ping to Voiso on save).

---

## 6. Backend — Click-to-call endpoint

| Item | Value |
|------|--------|
| **Method / path** | **`POST /api/admin/voiso/click2call`** |
| **Router** | `create_admin_voiso_router` nested at **`/api/admin/voiso`** (`backend/auth-service/src/lib.rs`) |
| **Handler** | `post_click2call` in `backend/auth-service/src/routes/admin_voiso.rs` |
| **Auth** | JWT + `check_call_permission` → **`call:view`** on permission profile (admins / `super_admin` bypass via role check) |

**Request JSON (`Click2CallRequest`, camelCase):**

```json
{ "agent": "1007", "number": "393511775043" }
```

- **`agent`:** Voiso **extension** (trimmed).  
- **`number`:** destination; server strips `+`, spaces, dashes, parentheses.

**Upstream Voiso calls (order):**

1. **Legacy:** `POST {base_url}/{api_key}/click2call` with **`form`** fields `agent`, `number`. Success if **2xx** or **204**.  
2. **v4 (two URLs):** `POST {cluster}/api/v4/click2call` and `POST {cluster}/api/v4/calls/click2call` with **`Authorization: Bearer {api_key}`** and JSON:

   ```json
   { "agent": "<agent>", "number": "<number>", "destination": "<number>" }
   ```

3. **Voice fallback:** `GET {cluster}/api/v4/users` (Bearer), parse array or wrapped `data`/`users`/`items`/`results`, match extension → Voiso `user_id`, then  
   `POST {cluster}/api/v4/voice/calls` with JSON:

   ```json
   { "user_id": "<voiso_user_id>", "phone_number": "<number>", "caller_id": "<number>" }
   ```

**Success response to client:** HTTP **`204 No Content`** (no JSON body).  
**Errors:** **400** validation, **403** missing `call:view`, **503** disabled or missing API key, **502** upstream/`VOISO_ERROR` with JSON body `{ "error": { "code": "...", "message": "..." } }`.

**API key resolution:** DB `platform_voiso_config.api_key` if non-empty, else **`VOISO_API_KEY`**.  
**Base URL resolution:** DB `click2call_url` if non-empty, else **`VOISO_CLICK2CALL_URL`**, else default `https://cc-ams03.voiso.com/api/v1`.

---

## 7. Backend — call records / webhooks / NATS

### Voiso webhooks

**There is no HTTP webhook endpoint in this codebase that receives Voiso call-completion callbacks.** PSTN call outcome is **not** persisted to `admin_call_records` by Voiso integration.

### NATS: `admin_call.events`

**Publisher:** `backend/ws-gateway/src/ws/session.rs` — on WebRTC call signaling (`call.initiate`, `call.answer`, `call.reject`, `call.end`, timeout), if NATS client is configured, publishes **plain JSON string** to subject **`admin_call.events`**.

**Subscriber:** `backend/auth-service/src/lib.rs` starts `CallRecordHandler::start_listener` subscribed to **`admin_call.events`**.

**Payload shape** (`CallEventPayload` in `call_record_handler.rs`):

```json
{
  "call_id": "<uuid>",
  "admin_user_id": "<uuid string>",
  "user_id": "<uuid string>",
  "event": "initiated|answered|rejected|ended|timeout",
  "admin_display_name": "optional",
  "ended_by": "optional (e.g. admin|user|timeout)"
}
```

**DB effects:**

| `event` | SQL effect |
|---------|------------|
| `initiated` | `INSERT ... ON CONFLICT (call_id) DO NOTHING` — status **`ringing`**, stores `admin_display_name`. |
| `answered` | `UPDATE` → `status = 'answered'`, sets `answered_at`. |
| `rejected`, `ended`, `timeout` | `UPDATE` → `status = <event>`, `ended_at`, `ended_by`, `duration_seconds` computed. |

**UNCERTAIN:** Whether Voiso offers webhooks you could optionally wire to the same table; not implemented here.

---

## 8. Frontend — `/admin/settings?tab=voiso`

| Item | Location |
|------|----------|
| **Page** | `src/features/settings/pages/SettingsPage.tsx` — tab id **`voiso`** from query `?tab=voiso`. |
| **Component** | `src/features/settings/components/VoisoSettingsTab.tsx` |
| **API** | `src/features/settings/api/voisoConfig.api.ts` |

**Form fields:**

| UI label | State / id | Type |
|----------|------------|------|
| Enable Voiso integration | `enabled` | `Switch` |
| Voiso API key | `voiso-api-key-input` | password/text toggle; never pre-filled with secret |
| Click2Call base URL | `voiso-click2call-url` | text |
| Embedded agent panel URL | `voiso-panel-url` | text |

**Save flow:** `updateVoisoConfig` → **`PUT /api/admin/settings/voiso`**; success toast **“Voiso settings saved”**; React Query cache updated.

**Reset:** local form reverts to last loaded GET response (no server round-trip).

**Permissions:**  
- **Edit** controls (`Switch`, inputs, Save) gated by **`settings:edit`** (`useCanAccess('settings:edit')` passed as `canEdit`).  
- **GET** still requires **`settings:view`** on the server for non-admin roles.

**Test connection:** **None** in UI.

---

## 9. Frontend — `/admin/voiso` embedded panel

| Item | Location |
|------|----------|
| **Route** | `src/app/router/adminRoutes.tsx` — path **`/admin/voiso`**, element **`AdminVoisoPage`**. |
| **Page** | `src/features/adminVoiso/pages/AdminVoisoPage.tsx` |
| **Nav** | `src/app/config/nav.ts` — label “Voiso”, **`permission: 'call:view'`**. |

**Embedding:** plain **`<iframe src={voisoPanelUrl}>`** — no `postMessage` bridge, no Voiso SDK script tag in this file.

**URL resolution order:**

1. **`GET /api/admin/voiso/config`** → `panelUrl` + `enabled` (`getVoisoPanelConfig` in `voiso.api.ts`).  
2. Else **`import.meta.env.VITE_VOISO_PANEL_URL`**.  
3. Else hardcoded **`https://cc-ams03.voiso.com/omnichannel/embedded`**.

**Standalone link:** `voisoPanelUrl.replace(/\/omnichannel\/embedded\/?$/, '/')` for “Open full panel”.

**Iframe attributes:**

```tsx
<iframe
  src={voisoPanelUrl}
  allow="microphone; camera; autoplay; clipboard-read; clipboard-write; display-capture"
  className="h-[720px] w-full border-0"
  title="Voiso Agent Panel"
/>
```

**No `sandbox` attribute.** **No query-string SSO** (no `?agent=` / `?token=` from this app — Voiso login happens **inside** the iframe).

**Permissions:** Backend **`GET /api/admin/voiso/config`** and **`POST .../click2call`** require **`call:view`** (see `check_call_permission` in `admin_voiso.rs`). Nav item also uses **`call:view`**.

---

## 10. Frontend — click-to-call triggers

| Surface | File | Trigger |
|---------|------|---------|
| **Admin Voiso page** | `src/features/adminVoiso/pages/AdminVoisoPage.tsx` | Form submit → `click2call({ agent, number })` in `src/features/adminVoiso/api/voiso.api.ts` → **`POST /api/admin/voiso/click2call`**. |

**Repository search** did not find other components calling `click2call` or `/api/admin/voiso/click2call` (e.g. no phone icon on user rows wired to Voiso in TS under `src/`). **UNCERTAIN:** Whether other branches or dynamic imports exist; primary documented path is **Admin Voiso** only.

**Separate feature — in-browser “Call user” (WebRTC):**  
`src/features/adminCalls/pages/AdminCallUserPage.tsx` sends **`call.initiate`** over the **global WebSocket** (`wsClient`) — this is **not** Voiso Click2Call; it drives **`admin_call.events`** and **`admin_call_records`**.

---

## 11. NATS / Redis involvement

| Mechanism | Subject / key | Publisher | Consumer |
|-----------|-----------------|-----------|----------|
| **NATS** | **`admin_call.events`** | `backend/ws-gateway/src/ws/session.rs` (WebRTC signaling) | `backend/auth-service/src/services/call_record_handler.rs` (subscribed in `lib.rs`) |
| **Redis** | — | **No Voiso-specific Redis keys** found in Voiso routes | — |

---

## 12. Security model

| Topic | Behavior in this codebase |
|-------|---------------------------|
| **API key at rest** | **Postgres** `platform_voiso_config.api_key` (**plaintext**) and/or **`VOISO_API_KEY`** env. |
| **API key to browser** | **Never** returned from `GET /api/admin/settings/voiso` — only booleans `apiKeyConfigured`, `storedApiKeyConfigured`, `envApiKeyConfigured`. |
| **Click2Call** | Browser calls **your backend**; backend calls Voiso with key **server-side**. |
| **Embedded panel** | Browser loads **Voiso’s** URL directly; authentication is **between the agent and Voiso** inside the iframe (no platform token passed in URL in this code). |
| **Webhook signature** | **N/A** (no Voiso webhook handler). |
| **Rate limits** | **UNCERTAIN** / not implemented specifically for Voiso in audited files. |

---

## 13. End-to-end flows

### A) Admin Voiso — PSTN Click2Call (Voiso)

1. **UI:** `AdminVoisoPage` → user submits agent + number → `handleSubmit` → `click2call` (`voiso.api.ts`).  
2. **HTTP:** `POST /api/admin/voiso/click2call` with Bearer JWT (via shared `http` client).  
3. **Backend:** `post_click2call` loads config, checks `enabled`, resolves API key + base URL, tries Voiso endpoints in order (§6).  
4. **Voiso:** rings **agent’s Voiso-connected endpoint first** per in-app toast copy (“The agent’s phone should ring”). **UNCERTAIN:** exact ring order for all Voiso account types.  
5. **Call history in this app:** **No** automatic row in `admin_call_records` from this flow.

### B) Admin “Call user” — WebRTC (not Voiso)

1. **UI:** `AdminCallUserPage` → `call.initiate` via WebSocket.  
2. **ws-gateway:** `session.rs` → ring target user → **`nats.publish("admin_call.events", ...)`** with `event: "initiated"`.  
3. **auth-service:** `CallRecordHandler` → **`INSERT` into `admin_call_records`**.  
4. **UI history:** `GET /api/admin/call-records` (`callRecords.api.ts`) for `AdminCallUserPage` / admin call history.

---

## 14. Integration checklist (other platform)

```
[ ] 1. Sign up for Voiso; obtain API key, cluster host (e.g. cc-ams03.voiso.com), embedded URL (/omnichannel/embedded), Click2Call base (/api/v1 or equivalent), agent extensions in Voiso Users
[ ] 2. UNCERTAIN: Complete Voiso-side domain / iframe / security allowlists per Voiso documentation for your hostname
[ ] 3. Create table platform_voiso_config (singleton row) — see §4.1 and SQL below
[ ] 4. (Optional) Create admin_call_records + NATS consumer if you replicate in-browser WebRTC calls — §4.2 / §7
[ ] 5. Set env: VOISO_API_KEY=... (optional fallback), VOISO_CLICK2CALL_URL=... (optional), VITE_VOISO_PANEL_URL=... (frontend build)
[ ] 6. Implement GET/PUT admin settings Voiso with shapes in §5; never return raw api_key
[ ] 7. Implement POST /api/admin/voiso/click2call proxy with legacy + v4 + voice fallback logic (§6)
[ ] 8. Implement settings UI saving to PUT .../voiso
[ ] 9. Implement /admin/voiso page: iframe src = panel URL from GET /api/admin/voiso/config (fallback build env)
[ ] 10. Implement Click2Call form calling POST .../click2call
[ ] 11. If using WebRTC call history: implement ws-gateway NATS publish + auth-service subscriber (§7); UNCERTAIN for Voiso-only stack
[ ] 12. Test: save config → open embedded panel → login in iframe → submit Click2Call → confirm agent rings and callee connects per Voiso
```

**Adapted `CREATE TABLE` (PostgreSQL-style, from migration 053 + comments):**

```sql
CREATE TABLE IF NOT EXISTS platform_voiso_config (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    api_key TEXT,
    click2call_url TEXT NOT NULL DEFAULT 'https://cc-ams03.voiso.com/api/v1',
    panel_url TEXT NOT NULL DEFAULT 'https://cc-ams03.voiso.com/omnichannel/embedded',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_voiso_config (singleton_id) VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;
```

---

## 15. Known gotchas

- **Two parallel “call” systems:** **Voiso PSTN** (Click2Call) vs **in-app WebRTC** (`call.*` WS messages + `admin_call.events`). Do not conflate them when porting.  
- **Cluster defaults** are hardcoded to **`cc-ams03.voiso.com`** in multiple places (backend defaults, frontend fallbacks, Docker compose build arg). Other tenants need URL overrides.  
- **Production frontend:** `VITE_VOISO_PANEL_URL` is a **build-time** Docker arg (`deploy/docker-compose.prod.yml`); changing only DB `panel_url` affects **`GET /api/admin/voiso/config`** consumers, but the **Vite fallback** still exists in `AdminVoisoPage.tsx`.  
- **API key in DB is plaintext** — protect database backups and access control.  
- **`call_record_handler` insert** uses status **`ringing`** while migration default text is **`initiated`** — intentional in code; reporting should accept both / actual values.  
- **Browser:** iframe **`allow`** includes microphone/camera; admins may need to grant permissions; third-party cookies / storage policies are **UNCERTAIN** per browser + Voiso.  
- **No CSP** configuration for Voiso documented in the files read.  
- **Click2Call error messages** may include Voiso response bodies — avoid logging full responses in production if they could contain PII (current code logs errors at `error!` level with body snippets).

---

## 16. Example payloads (`curl`-style)

Replace `https://auth.example.com` with your auth-service origin and `YOUR_JWT` with a valid admin JWT.

### Save Voiso config

```bash
curl -sS -X PUT 'https://auth.example.com/api/admin/settings/voiso' \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  -d '{
    "click2callUrl": "https://cc-ams03.voiso.com/api/v1",
    "panelUrl": "https://cc-ams03.voiso.com/omnichannel/embedded",
    "enabled": true,
    "apiKey": "YOUR_VOISO_API_KEY"
  }'
```

**Example success body:** same as §5 GET response (no secret fields).

### Click2Call request

```bash
curl -sS -D - -o /dev/null -X POST 'https://auth.example.com/api/admin/voiso/click2call' \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  -d '{"agent":"1007","number":"393511775043"}'
```

**Expected success:** HTTP **`204`** with empty body.

### Click2Call error example (shape)

```json
{
  "error": {
    "code": "VOISO_ERROR",
    "message": "Voiso returned 401 after trying supported Click2Call endpoints: ..."
  }
}
```

### Voiso legacy upstream (for reference — called server-side, not from browser)

```http
POST https://cc-ams03.voiso.com/api/v1/YOUR_VOISO_API_KEY/click2call
Content-Type: application/x-www-form-urlencoded

agent=1007&number=393511775043
```

### NATS `admin_call.events` (WebRTC path — not from Voiso)

```json
{
  "call_id": "550e8400-e29b-41d4-a716-446655440000",
  "admin_user_id": "11111111-1111-1111-1111-111111111111",
  "user_id": "22222222-2222-2222-2222-222222222222",
  "event": "initiated",
  "admin_display_name": "Support Admin"
}
```

### Example `admin_call_records` row (after initiate)

| Column | Example value |
|--------|----------------|
| `call_id` | `550e8400-e29b-41d4-a716-446655440000` |
| `admin_user_id` | `11111111-...` |
| `user_id` | `22222222-...` |
| `status` | `ringing` |
| `admin_display_name` | `Support Admin` |

---

## Appendix — permission keys (from code)

| Permission | Where |
|------------|--------|
| **`call:view`** | Voiso nav (`nav.ts`), `admin_voiso.rs`, `admin_call_records.rs` |
| **`settings:view`** | `GET .../settings/voiso` (`admin_settings.rs`) |
| **`settings:edit`** | `PUT .../settings/voiso`, Voiso settings form editability (`SettingsPage.tsx`) |

Seed reference: `infra/migrations/021_missing_permissions.sql` (`call:view`).
