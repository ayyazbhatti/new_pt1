# User Events — Device Detection (Design for Approval)

**Goal:** Record whether the user (or admin actor) was on **mobile**, **tablet**, **desktop**, or **unknown**, plus optional OS/browser, on every `user_events` row that has a `User-Agent`.

**Status:** Implemented (migration `055_user_events_device.sql`, server parsing, admin Device column + filter).

---

## 1. Professional principles

| Principle | How we follow it |
|-----------|------------------|
| **Server-side only** | Derive device from the standard `User-Agent` header (and optional `Sec-CH-UA-Mobile` as a *hint only*). Never trust a client-sent `X-Device-Type` for audit data (easily spoofed). |
| **Single choke point** | Enrich events inside `UserEventsService::record()` so all writers (auth, finance, future trading) get device metadata automatically — no copy-paste at 15 call sites. |
| **Fail-open** | If parsing fails or UA is missing → `device.class = "unknown"`. Auth, orders, and deposits behave exactly as today. |
| **No schema migration (v1)** | Store structured device fields in existing `meta` JSONB. Keeps migrations optional; full `user_agent` column stays for forensics. |
| **Backward compatible** | Old rows unchanged. New rows get `meta.device`. API/list UI unchanged until we add a column (optional later). |
| **Privacy** | Store device *class* and coarse OS/browser — not fingerprinting vectors beyond what UA already stores. |

---

## 2. What you have today

- **`user_events.user_agent`** — raw string (max 512 chars on insert), e.g. Firefox on macOS.
- **`user_events.meta`** — JSON; auth events put `email`, etc. **No device fields yet.**
- **Admin UI** — shows truncated UA in the table; admins must read the string manually.

Example (current row for `kynisagaf@mailinator.com`):

- `user_agent`: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0`
- `meta`: `{ "email": "..." }` only

---

## 3. Proposed storage shape

Add a stable object under **`meta.device`** on insert (does not remove or rename existing meta keys):

```json
{
  "email": "user@example.com",
  "device": {
    "class": "desktop",
    "os": "macOS",
    "browser": "Firefox",
    "source": "user-agent"
  }
}
```

### 3.1 `device.class` (required enum)

| Value | Meaning |
|-------|---------|
| `mobile` | Phone-sized clients (iPhone, Android Mobile, etc.) |
| `tablet` | iPad, Android tablet, large touch devices |
| `desktop` | Desktop/laptop browsers and desktop OS UAs |
| `bot` | Crawlers, monitors, known bots (optional; can map to `unknown` if you prefer fewer labels) |
| `unknown` | Missing UA, empty UA, or unparseable |

### 3.2 Optional fields

| Field | Example | Notes |
|-------|---------|--------|
| `os` | `iOS`, `Android`, `Windows`, `macOS`, `Linux` | Coarse; for admin display |
| `browser` | `Chrome`, `Safari`, `Firefox`, `Edge` | Coarse |
| `source` | `"user-agent"` | Always UA-driven in v1 |

**Not in v1:** model name (`iPhone 15`), exact version numbers (unless you want them later for support).

---

## 4. Implementation plan (isolated changes)

### 4.1 New utility — `backend/auth-service/src/utils/device_from_ua.rs`

- Pure function: `pub fn device_from_user_agent(ua: &str) -> DeviceInfo`
- Unit tests for: iPhone → mobile, iPad → tablet, Windows Chrome → desktop, empty → unknown, bot UAs → bot/unknown
- Parsing: small maintained crate (e.g. **`uaparser`**) *or* conservative heuristics if we want zero new dependencies (heuristics are acceptable for audit “class”; crate is more accurate for OS/browser)

### 4.2 One change in `user_events_service.rs` — `record()`

Before `INSERT`:

1. Start from caller’s `meta` object.
2. If `user_agent` is present, merge `device` into `meta` (do **not** overwrite if caller already set `meta.device`).
3. Insert as today.

**No changes** to:

- Login/register/password validation
- JWT issuance
- NATS / order-engine
- SQL for other tables
- Route signatures (except optional: no new extractors required)

### 4.3 Optional: `extract_client_meta` return type

Can stay as `(ip, user_agent)` — device is derived at persist time from UA, not from headers at route level. Keeps routes unchanged.

### 4.4 Frontend (small, after backend)

| Change | Risk |
|--------|------|
| `eventTypeLabel` / table column **Device** showing `meta.device.class` + OS | Display only |
| Filter by device class (later) | Needs API `meta` search or dedicated query param — **Phase 2** |

### 4.5 Backfill (optional, separate step)

One-off SQL or Rust script: `UPDATE user_events SET meta = meta || jsonb_build_object('device', …)` where `user_agent IS NOT NULL` and `meta->'device' IS NULL`, parsing UA in Rust (same utility). Does not block go-live.

---

## 5. Why this will not break other functionality

| Area | Impact |
|------|--------|
| **Auth (login/register/logout)** | Same success/failure paths; one extra JSON merge before insert; insert still fail-open. |
| **Sessions (`user_sessions`)** | Unchanged in v1 (device only on `user_events`). Can add later if you want “last device” on user profile. |
| **Trading / orders** | Unaffected until trading events are added; they will inherit device enrichment automatically. |
| **Admin list API** | Same response shape; `meta` gains `device` object. Clients that ignore unknown JSON keys keep working. |
| **DB size** | ~50–80 bytes per row in `meta`; negligible vs UA string. |
| **Performance** | UA parse ≈ microseconds per event; dominated by DB insert. |

**Regression checklist (run after implement):**

- [ ] Register / login / logout still return tokens and 200/204
- [ ] Failed login still does **not** create `user_events` row
- [ ] Deposit approve/reject still works
- [ ] User events page loads; new auth row shows `meta.device.class`
- [ ] Row without UA → `unknown`, no panic

---

## 6. Example outcomes

| User-Agent (abbreviated) | `device.class` | `os` | `browser` |
|--------------------------|----------------|------|-----------|
| `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 …) Safari/605.1.15` | mobile | iOS | Safari |
| `Mozilla/5.0 (iPad; CPU OS 17_0 …)` | tablet | iOS | Safari |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0` | desktop | macOS | Firefox |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0` | desktop | Windows | Chrome |
| `Mozilla/5.0 (Linux; Android 14; SM-S918B) … Mobile …` | mobile | Android | Chrome |
| *(empty)* | unknown | — | — |

---

## 7. Relationship to trading events

When you approve [USER_EVENTS_TRADING_PROPOSAL.md](./USER_EVENTS_TRADING_PROPOSAL.md), trading hooks only pass `user_agent` (on HTTP actions) as today. **Device enrichment happens in `record()`** — trading events get device metadata with no extra work per route.

System events (fill, liquidation) with no UA → `device.class = unknown` (expected).

---

## 8. Decisions for you

1. **Classes:** OK with `mobile | tablet | desktop | bot | unknown`?
2. **Storage:** `meta.device` only (no new DB column) for v1?
3. **Parser:** Prefer **accurate crate** (`uaparser`) vs **zero-deps heuristics**?
4. **Bots:** Show as `bot` or fold into `unknown`?
5. **Backfill:** Parse existing rows’ `user_agent` after deploy?
6. **UI:** Show Device column on User events page in the same PR or backend-only first?

---

## 9. Implementation order (after your OK)

1. `device_from_ua.rs` + tests  
2. Enrich `meta` in `user_events_service::record()`  
3. Manual test: register on phone + desktop → two rows with different `meta.device.class`  
4. Frontend Device column (if approved)  
5. Optional backfill script  

**Estimated scope:** ~150–250 lines Rust + small UI column; no migration required.

---

## 10. Approval

Reply with:

- **Approved** (and answers to §8), or  
- Changes you want (e.g. also store on `user_sessions`, or add DB column `device_class TEXT` for filtering).

Once approved, implementation will follow this doc only — trading events remain separate unless you also approve the trading proposal.
