# Voiso integration — full implementation guide

This document describes how to integrate **Voiso** (contact-center / telephony) with a web application: **Click2Call** (outbound) and **webhooks** (call lifecycle events). Use it to implement the same patterns in another project.

**Reference in this repo (minimal implementation today):**

- Backend: `backend/auth-service/src/routes/admin_voiso.rs` — authenticated proxy `POST /api/admin/voiso/click2call`
- Frontend: `src/features/adminVoiso/` — admin page + `voiso.api.ts`
- Env: `VOISO_API_KEY`, optional `VOISO_CLICK2CALL_URL`

The sections below include **everything needed for a complete integration** (webhooks, call records, UI states, WebSocket), not all of which may exist in this repository yet.

---

## 1. Architecture overview

```
┌─────────────┐     JWT API      ┌──────────────────┐     form POST      ┌──────────────┐
│  Web / SPA  │ ───────────────► │  Your backend    │ ────────────────► │ Voiso API    │
│             │                  │  (Click2Call)    │                   │ (per account)│
└─────────────┘                  └────────┬─────────┘                   └──────────────┘
                                            ▲
                                            │ HTTPS POST (webhook)
                                            │ JSON body includes `secret`
                                     ┌──────┴───────┐
                                     │    Voiso     │
                                     └──────────────┘
```

- **Click2Call**: Your server calls Voiso with the **API key** (never expose the key to the browser).
- **Webhooks**: Voiso **POSTs** JSON to a URL you configure in their dashboard. The shared **webhook secret** is typically **inside the JSON body**, not only in headers — verify against that field.
- **Agent panel**: Voiso’s agent UI is usually opened in a **new tab** (`X-Frame-Options` often blocks iframes).

---

## 2. Environment variables

Configure per deployment (Voiso account / cluster varies).

| Variable | Purpose |
|----------|---------|
| `VOISO_API_KEY` | Click2Call API key from Voiso dashboard (server-side only). |
| `VOISO_CLICK2CALL_URL` | Base URL for Click2Call. **Accounts differ**: e.g. `https://api.voiso.com/api/v1` or cluster-specific `https://cc-xxxxx.voiso.com/api/v1`. Default in reference code: `https://cc-ams03.voiso.com/api/v1`. |
| `VOISO_WEBHOOK_SECRET` | Expected value of the **`secret` field inside the webhook JSON payload** (see §4). Store server-side; compare after parsing body. |
| `VOISO_PANEL_URL` (optional) | URL shown to agents to open the Voiso panel (e.g. `https://cc-ams03.voiso.com/`). |

**URL format for Click2Call (common pattern):**

```text
POST {VOISO_CLICK2CALL_URL}/{VOISO_API_KEY}/click2call
Content-Type: application/x-www-form-urlencoded

agent=<extension>&number=<e164_digits_only>
```

- `number`: E.164 **without** leading `+` (digits only).
- `agent`: Voiso **extension** (e.g. `1007`), not the public caller ID string.

Support **both** base URL styles in config (trailing slash normalization: trim `/` before concatenation).

---

## 3. Voiso webhook — critical rules

1. **Secret in payload**  
   Voiso may send the webhook authentication **`secret` inside the JSON body**, not (only) in an HTTP header. Your verifier must read the parsed payload and compare `payload.secret` (or documented field name) to `VOISO_WEBHOOK_SECRET`.

2. **Event names use dot notation**  
   Real events look like:
   - `outbound.call.initiated`
   - `outbound.call.answered`
   - `outbound.call.ended`
   - `outbound.call.hangup` (or similar for dropped / agent hangup — confirm in Voiso docs for your product version)  
   Do **not** assume snake_case only (e.g. `call_answered`) unless your tenant’s docs say so.

3. **Always respond HTTP 200 to Voiso**  
   On validation errors, bad signature, unknown event, or internal failures: **log the error**, **do not** return 4xx/5xx to Voiso if their platform retries and marks webhooks **Inactive** after repeated failures (commonly ~5). Return `200 OK` with a small JSON body like `{ "ok": true }` or `{ "ok": false, "ignored": true }` after logging.

4. **Idempotency**  
   Webhooks may duplicate. Use Voiso call IDs in your DB with unique constraints.

---

## 4. Suggested payload shapes (implement defensively)

Voiso versions differ. Define types that accept **both** nested and flat fields.

### 4.1 Envelope

```json
{
  "event": "outbound.call.answered",
  "secret": "your-webhook-shared-secret",
  "data": { }
}
```

- **`event`**: string, dot notation.
- **`secret`**: must match server config (constant-time compare).
- **`data`**: call-specific object (structure below).

### 4.2 Call data — dual format (`VoisoCallData`)

**New-style (example):**

```json
{
  "call_id": "voiso-call-uuid-or-string",
  "direction": "outbound",
  "from": "+441234567890",
  "to": "+393511775043",
  "agent": {
    "id": "agent-id",
    "extension": "1007",
    "email": "agent@company.com"
  },
  "duration": {
    "total": 125,
    "talk_time": 98,
    "ring_time": 27
  }
}
```

**Legacy-style (example):**

```json
{
  "call_id": "…",
  "agent_id": "agent-id",
  "agent_extension": "1007",
  "agent_email": "agent@company.com"
}
```

Implement **`extract_call_data`** (or equivalent) that:

- Prefers nested `agent` when present.
- Falls back to `agent_id`, `agent_extension`, `agent_email`.

### 4.3 Duration sub-object (`VoisoCallDuration`)

```ts
// Conceptual
interface VoisoCallDuration {
  total?: number      // seconds
  talk_time?: number
  ring_time?: number
}
```

For **call ended**, read **`duration.total`** (and optionally `talk_time`) when updating call records.

### 4.4 Agent sub-object (`VoisoAgentObject`)

```ts
interface VoisoAgentObject {
  id?: string
  extension?: string
  email?: string
}
```

---

## 5. Webhook handler behavior

| Event (examples) | Suggested action |
|------------------|------------------|
| `outbound.call.initiated` | Create or update call row; resolve **your** user/agent by `extension` / `email` / Voiso `id` (`find_user_by_voiso_extension` or similar). |
| `outbound.call.answered` | Set `answered_at`, status answered. |
| `outbound.call.ended` | Set `ended_at`, `duration_seconds` from `duration.total` (or best available). |
| `outbound.call.hangup` | Handle dropped / hangup edge cases; reconcile status. |
| Unknown `event` | Log at `warn`, return 200, no panic. |

**`verify_webhook_signature` / secret check:**

1. Parse JSON body.
2. Read `secret` from payload (not only headers).
3. Constant-time equality with `VOISO_WEBHOOK_SECRET`.
4. If mismatch: log, return **200** (do not tell Voiso to retry forever with 401).

---

## 6. Backend service layer (recommended)

### 6.1 `VoisoService`

- **`start_click2call(agent_extension, number_digits)`** — POST to Voiso form endpoint; map errors to your `Click2CallResult`.
- **`stop_click2call(...)`** — if Voiso API supports cancel/hangup for Click2Call sessions (confirm docs).
- **`get_agent_statuses()`** — if Voiso exposes an API for presence (optional).

Base URL builder: accept both `https://host/api/v1` and `https://host/api/v1/` (normalize).

### 6.2 `CallService` (domain)

- **`initiate_click2call`** — ensure caller has permission; ensure **agent profile has `voiso_extension` set**; otherwise return a **clear 4xx** to your SPA (this rule is for *your* API, not for Voiso’s webhook).
- **`stop_click2call`** — delegate to Voiso if supported.
- **`create_call_from_voiso_data`** — map webhook `data` → internal call record + link to `user_id` / `admin_user_id` as needed.

### 6.3 HTTP routes

**Webhooks (no JWT, use payload secret):**

- `POST /api/webhooks/voiso` (or `/api/click2call/webhook` — keep **one** public URL matching Voiso dashboard).

**Authenticated Click2Call API (example checklist):**

- Mount under e.g. `/api/click2call` with handlers such as:
  - `POST .../initiate`
  - `POST .../stop`
  - `GET .../status` or agent list
  - (adjust to your 5-handler design)

Register in your main **`configure_routes`** / app builder.

**Separate from admin-only proxy:**  
This repo uses `POST /api/admin/voiso/click2call` for admins with `call:view`. A full product might also expose agent-facing routes under `/api/click2call` with different auth.

### 6.4 Database

- Add **`voiso_extension`** (and optionally `voiso_agent_id`) on **users** or **staff profiles**.
- Query **`find_user_by_voiso_extension`** (and by email if webhook sends it).
- Call history table: store `external_call_id` (Voiso), timestamps, duration, status.

### 6.5 `Click2CallResult` (Rust / your language)

```rust
// Conceptual
pub struct Click2CallResult {
    pub success: bool,
    pub message: Option<String>,
    pub voiso_call_id: Option<String>,
}
```

---

## 7. WebSocket (optional)

If agents get live UI updates:

- Broadcast **`Click2CallStarted`** (or similarly named) message after successful initiate, with `{ callId, targetNumber, … }` so the client can show **CALLING** state and start a **timer** (drive timer from client clock + server timestamp, not polling).

Use your existing WS auth pattern (JWT on connect, etc.).

---

## 8. Frontend

### 8.1 API module (`click2call.api.ts`)

Wrap all backend methods, e.g.:

- `initiateClick2Call(body)`
- `stopClick2Call(id)`
- `getAgentStatuses()`
- (plus any other endpoints you added)

Use your shared `fetch` / `http` client with credentials.

### 8.2 `Click2CallButton` — four states (example)

1. **Idle** — show “Call”.
2. **CALLING** — show spinner + **elapsed timer** (started when initiate succeeds or when WS says started).
3. **In call** — show “End call” if you support stop.
4. **Error** — show message (e.g. missing `voiso_extension`).

### 8.3 `DialPad`

- Full **12-key** grid (0–9, `*`, `#`) + optional backspace; feeds destination number into initiate.

### 8.4 UX entry points (examples)

- **Sidebar** “New Call” opens `DialPad` (modal or drawer).
- **ActiveCallPage** — end-call control wired to `stop_click2call`.
- **CallHistoryPage** — per-row **callback** → prefill number and initiate.
- **AgentsListPage** — “Call agent” uses their `voiso_extension`.

### 8.5 Admin Voiso page (this repo)

- Panel link + manual agent extension + number: `src/features/adminVoiso/pages/AdminVoisoPage.tsx`
- Agents must keep Voiso panel open in another tab for Click2Call to ring through.

---

## 9. Implementation checklist (copy for your other project)

Use this as a task list; adjust names to your stack.

**Webhooks**

- [ ] Webhook route registered; URL pasted into Voiso dashboard.
- [ ] Event names parsed as **real Voiso dot notation** (`outbound.call.answered`, not only `call_answered`).
- [ ] `VoisoWebhookPayload` includes **`secret` inside JSON**; verification uses **payload.secret**.
- [ ] `VoisoCallData` supports **new** (nested `agent`) and **legacy** (flat `agent_id`, `agent_extension`, …).
- [ ] `VoisoCallDuration` with `total`, `talk_time`, `ring_time`.
- [ ] `VoisoAgentObject` with `email`, `extension`, `id`.
- [ ] `extract_call_data` merges both formats.
- [ ] `handle_call_initiated` resolves agent by extension / email / id.
- [ ] `handle_call_ended` uses `duration.total` (fallbacks documented).
- [ ] `handle_call_hangup` for dropped calls.
- [ ] Unknown events: log + **HTTP 200**.

**Click2Call services**

- [ ] `VoisoService`: `start_click2call`, `stop_click2call`, `get_agent_statuses` (as applicable).
- [ ] Base URL supports **both** Voiso URL styles via env.
- [ ] `CallService`: `initiate_click2call`, `stop_click2call`, `create_call_from_voiso_data`.
- [ ] `find_user_by_voiso_extension` (and email if needed).
- [ ] `Click2CallResult` defined; clear error if **`voiso_extension` missing** on agent.

**HTTP**

- [ ] All click2call-related handlers implemented and mounted under **`/api/click2call`** (or your chosen prefix).
- [ ] `configure_routes` includes webhook + click2call routes.

**Frontend**

- [ ] `click2call.api.ts` with all client methods.
- [ ] `Click2CallButton` with 4 states + call timer in CALLING.
- [ ] `DialPad` 12-key; opens from **New Call**.
- [ ] Active call / history / agents list integrations as needed.
- [ ] Optional: **Click2CallStarted** WS message.

**Quality gates**

- [ ] `cargo check` (or your backend) — zero errors.
- [ ] `npm run build` — zero TypeScript errors.

---

## 10. Security summary

| Item | Practice |
|------|----------|
| API key | Server env only; never send to browser. |
| Webhook secret | Compare **payload** field to env; constant-time compare. |
| Webhook URL | HTTPS; no JWT required if secret-in-body is sufficient (or add additional checks). |
| Admin proxy | JWT + permission (e.g. `call:view`) for human-initiated Click2Call. |
| Response codes to Voiso | Prefer **always 200** on webhook to avoid Inactive webhook. |

---

## 11. Voiso documentation

Implementation details (exact field names, extra events) change by Voiso product version. Always cross-check:

- Your Voiso **dashboard** → API / webhooks section.
- Official Voiso API docs for your cluster.

This guide encodes **defensive** parsing and **operational** rules (200 on webhook, secret-in-body, dual payload shapes) that are commonly required in production.

---

## 12. Mapping to this repository (new_pt1)

| Piece | Location / status |
|-------|-------------------|
| Admin Click2Call proxy | `backend/auth-service/src/routes/admin_voiso.rs` |
| Router mount | `backend/auth-service/src/main.rs` → `/api/admin/voiso` |
| Admin UI | `src/features/adminVoiso/` |
| Call records (WebRTC admin↔user) | `admin_call_records` migration — separate from Voiso webhook lifecycle unless you unify models |
| Webhooks / `/api/click2call` / full checklist | **Not fully implemented** in repo as of this doc — use §5–§9 to add in this or another project |

---

*End of Voiso integration guide.*
