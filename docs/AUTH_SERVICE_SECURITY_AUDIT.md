# Auth Service Security & Correctness Audit

**Scope:** Authentication and authorization layer in `backend/auth-service` (auth service, JWT, permission checks, middleware, auth/admin user/manager/permission routes, related migrations).  
**Method:** Static read-only review. No code was modified.  
**Date:** 2026-05-19

---

# 0. Executive Summary

The auth layer uses **Argon2** password hashing, **HS256 JWTs** with refresh tokens stored as **SHA-256 hashes** in `user_sessions`, and a **permission-profile RBAC** model with tag-based group scoping for managers. Several foundations are sound. Critical gaps remain: **no rate limiting** on login or password-reset OTP verification, **OTP and reset tokens logged at INFO**, a **known dev JWT secret fallback** if `JWT_SECRET` is unset, **middleware trusts JWT claims only** (no live DB check for deleted/disabled users or revoked sessions), **impersonation** gated only by `users:edit` with no target restrictions or `impersonator` claim, and **admin user mutation endpoints do not apply tag/group scoping** (`ensure_user_in_allowed_groups` is never used in `admin_users.rs`). The `admin` role **fully bypasses** `check_permission`, so JWT `role` and DB profile can diverge in dangerous ways.

**Trust score: 4/10** — Better than the order engine for crypto primitives, but account takeover and horizontal privilege escalation paths are realistic without rate limits and scoping on admin APIs.

**Go/no-go:** **No-go** for production margin trading until Critical/High auth issues are addressed.

**Top 3 issues by severity:**
1. **No brute-force protection on login / OTP verify** — 6-digit OTP and passwords can be attacked at scale (F1, F2).
2. **Admin API IDOR: scoped managers can act on any user UUID** — impersonate, account summary, profile edits without group checks (F3).
3. **JWT dev secret fallback + no access-token revocation** — misconfig or stolen token window (F4, F5).

---

# 1. Module Inventory

| Path | Lines | Purpose |
|------|------:|---------|
| `src/services/auth_service.rs` | 850 | Register, login, refresh, logout, sessions, impersonate, user listing, audit/user_events |
| `src/utils/jwt.rs` | 88 | HS256 access JWT issue/verify, refresh token generation, TTL env |
| `src/utils/hash.rs` | 33 | Argon2 passwords, SHA-256 token hashing |
| `src/utils/permission_check.rs` | 122 | `check_permission` (admin bypass), `check_permission_profile_only` |
| `src/middleware/auth_middleware.rs` | 34 | Bearer JWT verify → `Claims` in extensions |
| `src/routes/auth.rs` | 1902 | `/api/auth/*` public + protected routes, password reset, list users |
| `src/routes/scoped_access.rs` | 426 | Tag→group scoping helpers for other modules |
| `src/routes/admin_users.rs` | 1442 | Admin user CRUD, impersonate, account summaries, notes |
| `src/routes/admin_managers.rs` | 2248 | Manager CRUD, statistics, role assignment on create |
| `src/routes/admin_permission_profiles.rs` | 780 | Permission profile CRUD, Full Access protection |
| `database/migrations/0001_auth_users.sql` | — | `user_sessions`, `password_reset_tokens`, `audit_logs` (repo root) |
| `migrations/20260307100000_create_permission_definitions.sql` etc. | — | Permission keys/grants seeds (auth-service/migrations) |

**Dead / duplicate logic:**
- `resolve_allowed_group_ids_for_list_users` in `auth.rs` (lines 1485–1665) **duplicates and diverges** from `scoped_access::resolve_allowed_group_ids` (admin-without-manager-row semantics differ).
- `get_effective_permissions` (permission profiles service) **ignores `role`** for UI permission lists, while `check_permission` **ignores profile for `admin`/`super_admin`** — two different RBAC models.

---

# 2. Architecture & Data Flow

```
[Client]
   | POST /api/auth/register  (?ref=signup_slug, referral_code)
   v
[auth_service::register] --> Argon2 hash --> INSERT users (role='user')
   |                          --> INSERT user_sessions (refresh hash)
   |                          --> JWT access (HS256) + refresh (random base64)
   v
[Client stores tokens]

[Client] POST /api/auth/login
   v
[auth_service::login] --> verify Argon2 --> session row --> JWT + refresh

[Client] POST /api/auth/refresh  { refresh_token }
   v
[auth_service::refresh] --> SHA256(refresh) lookup user_sessions
   |                      --> NEW access JWT (same refresh, no rotation)

[Client] POST /api/auth/logout  Authorization: Bearer + { refresh_token }
   v
[auth_service::logout] --> is_revoked=true for matching session

[Password reset]
   request --> INSERT password_reset_tokens (OTP hash, 10m)
   verify  --> check OTP hash --> REPLACE row hash with reset_token (15m)
   confirm --> UPDATE password_hash, used_at

[Impersonate] POST /api/admin/users/:id/impersonate
   v
[check_permission users:edit] --> create_session(target) --> JWT as target (no impersonator claim)
```

### Endpoints (in scope)

| Method | Path | Auth | Who / permission |
|--------|------|------|------------------|
| POST | `/api/auth/register` | None | Public |
| POST | `/api/auth/login` | None | Public |
| POST | `/api/auth/refresh` | None | Public (body: refresh_token) |
| POST | `/api/auth/password-reset/request` | None | Public |
| POST | `/api/auth/password-reset/verify` | None | Public |
| POST | `/api/auth/password-reset/confirm` | None | Public |
| POST | `/api/auth/logout` | Bearer | Any authenticated user |
| GET/PATCH | `/api/auth/me` | Bearer | Self |
| GET | `/api/auth/users` | Bearer | Authenticated; list scoped by role/tags |
| POST | `/api/admin/users` | Bearer | `users:create` |
| POST | `/api/admin/users/:id/impersonate` | Bearer | `users:edit` |
| PUT | `/api/admin/users/:id/*` | Bearer | Various `users:edit_*` / `users:edit` |
| POST | `/api/admin/users/account-summaries` | Bearer | `users:view` (no group scope) |
| CRUD | `/api/admin/managers` | Bearer | `managers:*` permissions |
| CRUD | `/api/admin/permission-profiles` | Bearer | `permissions:*` |

### JWT structure

```8:31:backend/auth-service/src/utils/jwt.rs
pub struct Claims {
    pub sub: Uuid, // user_id
    pub email: String,
    pub role: String,
    pub group_id: Option<Uuid>,
    pub exp: i64,
    pub iat: i64,
}
```

- **Algorithm:** `Header::default()` → **HS256** (`encode`/`decode` with `EncodingKey::from_secret`).
- **Secret:** `JWT_SECRET` env; if missing/empty → **hardcoded dev fallback** (see F4).
- **TTL:** `ACCESS_TOKEN_TTL_SECONDS` default **900** (15 min); refresh **30 days**.
- **Not in JWT:** `jti`, `nbf`, `impersonator_id`, session id.
- **Transport:** `Authorization: Bearer` only in middleware (no cookie auth in middleware).

### Session storage

- Table `user_sessions`: `refresh_token_hash` (SHA-256 of opaque refresh string), `user_agent`, `ip`, `expires_at`, `is_revoked`.
- Refresh token: 32 random bytes, base64 (`generate_refresh_token`).
- **Logout:** revokes one session matching `user_id` + refresh hash.
- **Refresh:** does **not** rotate refresh token or revoke old session (F6).

### Permission resolution

```
Request → auth_middleware → verify_access_token → Claims
        → handler calls check_permission(pool, &claims, "key")
              → if role admin|super_admin → Ok (no DB profile check)
              → else load permission_profile_id → EXISTS in permission_profile_grants
```

---

# 3. Findings (DETAILED)

---
### F1: No rate limiting on login, registration, or password-reset OTP
- **Severity:** 🔴 Critical
- **Category:** Rate Limit | Account Takeover
- **Location:** `backend/auth-service/src/routes/auth.rs:674–682` (public routes); no `governor`/Redis limiter in auth module
- **Code:**

```674:682:backend/auth-service/src/routes/auth.rs
    let public_routes = Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/password-reset/request", post(password_reset_request))
        .route("/password-reset/verify", post(password_reset_verify))
        .route("/password-reset/confirm", post(password_reset_confirm));
```

- **What's wrong:** Rate limiting exists for **AI chat/reports only** (`ai_chat.rs`, `ai_reports.rs`), not auth endpoints.
- **Attack scenario:** Attacker runs `POST /password-reset/verify` with email `victim@x.com` and loops OTP `000000`–`999999` (~1M attempts). No lockout. Parallel `POST /login` brute-forces passwords for known emails.
- **Impact:** Account takeover via OTP or weak password.
- **Recommended fix:** Per-IP and per-account Redis counters on login, verify (max ~5–10 failures / 15 min), exponential backoff; CAPTCHA after threshold.

---
### F2: Password-reset OTP logged in plaintext at INFO
- **Severity:** 🔴 Critical
- **Category:** Information Disclosure | Audit Trail
- **Location:** `backend/auth-service/src/routes/auth.rs:421`, `433`
- **Code:**

```421:421:backend/auth-service/src/routes/auth.rs
    tracing::info!("Password reset OTP for {} (user_id={}): {}", email, user_id, otp);
```

- **What's wrong:** 6-digit OTP appears in application logs (and warn paths on email failure).
- **Attack scenario:** Anyone with log access (support, compromised log aggregator) resets any account using logged OTP within 10 minutes.
- **Impact:** Full account takeover.
- **Recommended fix:** Remove OTP from logs; log only `user_id` + `token_id`; use structured audit without secret.

---
### F3: Admin user endpoints lack tag/group scoping (IDOR)
- **Severity:** 🔴 Critical
- **Category:** Authorization | Privilege Escalation
- **Location:** `backend/auth-service/src/routes/admin_users.rs` — **no** `ensure_user_in_allowed_groups` / `resolve_allowed_group_ids` usage (grep: zero matches)
- **Code (impersonate example):**

```623:642:backend/auth-service/src/routes/admin_users.rs
async fn impersonate_user(...) -> ... {
    permission_check::check_permission(&pool, &claims, "users:edit")
        .await
        .map_err(permission_denied_to_response)?;
    ...
    let (access_token, refresh_token) = service
        .impersonate(claims.sub, user_id, ...)
```

- **What's wrong:** Any principal with `users:edit` (or **`admin` role bypass**) can call `PUT /api/admin/users/{any-uuid}/...`, `impersonate`, `account-summary`, `account-summaries` for users outside their tag scope.
- **Attack scenario:** Scoped manager with `users:edit` on a limited profile obtains victim UUID from another channel, `POST .../impersonate`, receives valid JWT as victim → places trades, withdraws (if finance routes also unscoped — see §8).
- **Impact:** Horizontal privilege escalation; full customer account takeover.
- **Recommended fix:** After `check_permission`, call `scoped_access::ensure_user_in_allowed_groups` on every `:id` route and filter `account-summaries` IDs to allowed set.

---
### F4: JWT_SECRET dev fallback if env unset
- **Severity:** 🔴 Critical (when misconfigured)
- **Category:** Cryptography | Authentication
- **Location:** `backend/auth-service/src/utils/jwt.rs:36–44`
- **Code:**

```36:44:backend/auth-service/src/utils/jwt.rs
pub fn get_jwt_secret() -> String {
    const DEV_FALLBACK: &str = "dev-jwt-secret-key-change-in-production-minimum-32-characters-long";
    match env::var("JWT_SECRET") {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            warn!("JWT_SECRET not set; using dev fallback. Set JWT_SECRET in production.");
            DEV_FALLBACK.to_string()
        }
    }
}
```

- **What's wrong:** Predictable secret is **in source code**; any deployment missing `JWT_SECRET` accepts forgeable JWTs.
- **Impact:** Forge tokens for any `sub`/`role`/`group_id`.
- **Recommended fix:** Fail startup if `JWT_SECRET` missing in production; use `secrecy` + min 32 bytes from CSPRNG; document rotation.

---
### F5: No access-token revocation / deny list
- **Severity:** 🟠 High
- **Category:** Session Mgmt
- **Location:** `backend/auth-service/src/middleware/auth_middleware.rs:26–27`; `auth_service.rs:348–382` (refresh)
- **What's wrong:** Stolen access JWT valid until `exp` (~15 min). Logout only revokes **refresh** session. Password reset does not revoke `user_sessions` (F7). Role/profile changes do not invalidate outstanding JWTs.
- **Impact:** Stolen bearer token, fired employee, or post-reset attacker retains API access for TTL.
- **Recommended fix:** Short access TTL + refresh rotation; optional `session_version` on user row checked in middleware; on password reset/role change bump version.

---
### F6: Refresh token not rotated on refresh
- **Severity:** 🟠 High
- **Category:** Session Mgmt
- **Location:** `backend/auth-service/src/services/auth_service.rs:348–382`
- **Code:**

```378:381:backend/auth-service/src/services/auth_service.rs
        let claims = Claims::new(user.id, user.email.clone(), user.role.clone(), user.group_id);
        let access_token = generate_access_token(&claims)?;
        Ok(access_token)
```

- **What's wrong:** Same refresh token reusable until expiry (30 days) or explicit logout.
- **Impact:** Leaked refresh token grants long-lived access; no detection of reuse.
- **Recommended fix:** Issue new refresh token, replace hash in DB, detect reuse of old hash → revoke all sessions for user.

---
### F7: Password reset does not revoke existing sessions
- **Severity:** 🟠 High
- **Category:** Session Mgmt | Account Takeover
- **Location:** `backend/auth-service/src/routes/auth.rs:630–665` (`password_reset_confirm`)
- **What's wrong:** Only updates `users.password_hash` and marks reset token used; no `UPDATE user_sessions SET is_revoked = true WHERE user_id = $1`.
- **Impact:** Attacker with active refresh token keeps access after victim resets password.
- **Recommended fix:** Revoke all sessions on password change/reset confirm.

---
### F8: Impersonation: weak gate, no audit in `audit_logs`, no impersonator claim
- **Severity:** 🟠 High
- **Category:** Authorization | Audit Trail | Privilege Escalation
- **Location:** `admin_users.rs:623–657`, `auth_service.rs:437–457`
- **Code:**

```437:457:backend/auth-service/src/services/auth_service.rs
    pub async fn impersonate(...) -> anyhow::Result<(String, String)> {
        let user = self.get_user_by_id(target_user_id).await?;
        let tokens = self.create_session(&user).await?;
        self.record_user_event(..., "admin.impersonate", ..., actor_user_id: Some(actor_user_id), ...)
```

- **What's wrong:** Requires only `users:edit`. No block on target `super_admin`/`admin`, no scoped-access check, JWT **indistinguishable** from real user (no `impersonator_id`), **same TTL** as normal login, `log_audit` **not called** (only `user_events`). Full trading capability as victim.
- **Attack scenario:** Compromised manager credentials → impersonate high-value user → trade/withdraw.
- **Recommended fix:** Dedicated `users:impersonate` permission; deny admin/super_admin targets; short-lived impersonation JWT claim; write `audit_logs` with IP/UA; optional read-only impersonation mode.

---
### F9: Middleware does not revalidate user status from DB
- **Severity:** 🟠 High
- **Category:** Authentication | Authorization
- **Location:** `backend/auth-service/src/middleware/auth_middleware.rs:9–32`
- **What's wrong:** Only `verify_access_token`; no check `deleted_at`, `status`, or current `role`/`permission_profile_id` in Postgres.
- **Attack scenario:** User disabled or soft-deleted while access JWT still valid → continues API access for up to 15 minutes.
- **Recommended fix:** Lightweight DB/cache lookup per request or session version in JWT.

---
### F10: `admin` role bypasses all permission profile checks
- **Severity:** 🟠 High
- **Category:** Authorization | Privilege Escalation
- **Location:** `backend/auth-service/src/utils/permission_check.rs:26–28`
- **Code:**

```26:28:backend/auth-service/src/utils/permission_check.rs
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
```

- **What's wrong:** JWT `role` from login time grants **full API access** regardless of `permission_profile_id` in DB. `get_effective_permissions` returns profile keys only (for UI), not enforcement.
- **Attack scenario:** Admin demoted in DB to limited profile but JWT still says `admin` until expiry → retains full access. Or `create_manager` sets `role = admin` with powerful profile (F11).
- **Impact:** RBAC bypass for anyone with `role=admin` in JWT.
- **Recommended fix:** Enforce profile grants for all non-`super_admin` roles; only `super_admin` may bypass; or reload role from DB in middleware.

---
### F11: `create_manager` can set user `role` to `admin`
- **Severity:** 🟠 High
- **Category:** Privilege Escalation
- **Location:** `backend/auth-service/src/routes/admin_managers.rs:1691–1704`
- **Code:**

```1693:1703:backend/auth-service/src/routes/admin_managers.rs
    let new_role = payload
        .role
        .as_deref()
        .filter(|r| *r == "manager" || *r == "agent" || *r == "admin")
        .unwrap_or("manager");
    sqlx::query(
        "UPDATE users SET role = $1, permission_profile_id = $2, updated_at = NOW() WHERE id = $3",
    )
```

- **What's wrong:** Caller with `managers:create` can promote user to **`admin`**, which then **bypasses all permission checks** (F10).
- **Recommended fix:** Only `super_admin` may assign `admin`; managers default to `manager` only.

---
### F12: Login information disclosure (inactive vs invalid credentials)
- **Severity:** 🟡 Medium
- **Category:** Information Disclosure
- **Location:** `backend/auth-service/src/services/auth_service.rs:296–306`
- **Code:**

```296:306:backend/auth-service/src/services/auth_service.rs
            None => {
                return Err(anyhow::anyhow!("Invalid credentials"));
            }
        ...
        if user.status != UserStatus::Active {
            return Err(anyhow::anyhow!("Account is not active"));
        }
```

- **What's wrong:** Different messages reveal account existence/state vs wrong password (timing may also differ before Argon2).
- **Recommended fix:** Uniform `"Invalid credentials"` for all failures; optional constant-time delay.

---
### F13: Registration reveals existing email
- **Severity:** 🟡 Medium
- **Category:** Information Disclosure
- **Location:** `auth_service.rs:68–69`, `auth.rs:888–893`
- **What's wrong:** `EMAIL_EXISTS` / `"Email already registered"` on register.
- **Recommended fix:** Generic success message (same as password-reset request pattern).

---
### F14: OTP entropy and verify brute force (6 digits, `thread_rng`)
- **Severity:** 🟠 High (with F1)
- **Category:** Cryptography | Authentication
- **Location:** `auth.rs:394–396`
- **Code:**

```394:396:backend/auth-service/src/routes/auth.rs
    let otp: String = (0..6)
        .map(|_| rand::thread_rng().gen_range(0..10).to_string())
        .collect();
```

- **What's wrong:** 10^6 space; `rand::thread_rng` acceptable for OTP but **no attempt limit** makes it feasible. Multiple active OTP rows per user allowed (INSERT each request).
- **Recommended fix:** `OsRng` + 8+ alphanumeric or longer numeric; invalidate prior OTPs per user; rate limit verify.

---
### F15: Scoped access divergence: `admin` list users vs `scoped_access`
- **Severity:** 🟡 Medium
- **Category:** Authorization
- **Location:** `auth.rs:1497–1540` vs `scoped_access.rs:50–53`
- **What's wrong:** `scoped_access` says admin **without** `managers` row → **no filter** (all groups). `resolve_allowed_group_ids_for_list_users` applies **tag-based** filter to **all** `admin` users. Inconsistent platform behavior.
- **Recommended fix:** Single resolver used everywhere; document intended model.

---
### F16: `/api/auth/users` returns permission lists for every user
- **Severity:** 🟡 Medium
- **Category:** Information Disclosure
- **Location:** `auth.rs:1833–1852`, `UserResponse.permissions`
- **What's wrong:** Managers see other users' effective permission key lists (admin surface map).
- **Recommended fix:** Omit `permissions` from list response unless caller has elevated column permission.

---
### F17: Failed login not audited
- **Severity:** 🟡 Medium
- **Category:** Audit Trail
- **Location:** `auth_service.rs:296–311` (warn only, no `log_audit` / `user_events`)
- **What's wrong:** Successful login recorded; failures not in `audit_logs` or `user_events`.
- **Impact:** Cannot detect credential stuffing from audit trail.
- **Recommended fix:** `auth.login_failed` event with IP/UA (no email in meta if concerned).

---
### F18: `audit_logs` lacks IP/user_agent columns
- **Severity:** 🟡 Medium
- **Category:** Audit Trail
- **Location:** `database/migrations/0001_auth_users.sql:128–135`, `auth_service.rs:691–704`
- **What's wrong:** `log_audit` stores only `actor_user_id`, `action`, `meta`. IP/UA only in `user_events` when explicitly passed.
- **Impact:** Incomplete forensic trail in `audit_logs`.

---
### F19: `check_permission_profile_only` — confirmed stricter; limited use
- **Severity:** 🔵 Low (informational)
- **Category:** Authorization
- **Location:** `permission_check.rs:74–122`; used in `admin_kyc.rs` for `kyc:approve` only (grep)
- **Evidence:** `super_admin` bypasses; **`admin` does not** — stricter than `check_permission`. **No issue** for KYC path; most admin routes use `check_permission` instead.

---
### F20: Full Access profile protection — partial
- **Severity:** 🔵 Low
- **Category:** Authorization
- **Location:** `admin_permission_profiles.rs:272–306`
- **What's wrong:** Edit/delete blocked for name "full access"; **grants can still be changed** if `ensure_not_full_access_profile` only guards delete/update name paths — verify all mutation paths call it (update at 404, 688, 765 — **yes**). Assigning users to Full Access profile still possible if profile id known.
- **No critical issue** on delete/edit name.

---
### F21: `unreachable!()` in bulk user creation
- **Severity:** 🟡 Medium
- **Category:** Error Handling
- **Location:** `auth_service.rs:819`
- **Code:** `Ok(None) => unreachable!(),`
- **Impact:** Panic if INSERT returns no row unexpectedly → DoS on admin bulk path.

---
### F22: Password rules: min 8 + one digit only
- **Severity:** 🟡 Medium
- **Category:** Input Validation
- **Location:** `auth_service.rs:52–57`
- **What's wrong:** No max length (DoS via Argon2 on huge password), no uppercase/symbol requirements.
- **Recommended fix:** Max length 128; use Argon2 with consistent params documented.

---

### Pattern: `admin` JWT role stale until refresh (3.11)

- **Confirmed:** `Claims` embed `role` at login/refresh (`auth_service.rs:379`). Refresh reloads user from DB and builds **new** `Claims` — **role updates apply on refresh**, not immediately on access token.
- **Intended?** Partially — 15-minute stale window for access token.

---

## 3.1 Password handling — checklist

| Check | Result |
|-------|--------|
| Hashing | **Argon2** via `Argon2::default()` + `OsRng` salt (`hash.rs:6–13`) ✓ |
| Hash in logs/responses | **No issue found** in API responses; password_hash from DB not serialized in `UserResponse` ✓ |
| Validation | Min 8 + one digit; no max length (F22) |
| Timing | Inactive account branch before password verify may leak (F12); Argon2 verify not constant-time across user-not-found |
| OTP | 6 digits, `thread_rng`, 10m expiry, single-use via `used_at` on confirm path; **logged** (F2,F14) |
| Reset token | UUID string, SHA-256 stored, 15m after verify; `used_at` set on confirm ✓ |
| Password change revokes sessions | **No** (F7) |

---

## 3.2 JWT correctness — checklist

| Check | Result |
|-------|--------|
| Algorithm | HS256 (`Header::default()`) ✓ |
| Algorithm confusion | `jsonwebtoken` `Validation::default()` rejects `none` for HMAC keys ✓ (library behavior) |
| Secret | Env + **dev fallback** (F4) |
| Claims checked | `exp`/`iat` via library; **`role`/`group_id` not revalidated** (F9) |
| Refresh vs access | Refresh is opaque base64, not JWT — cannot use as Bearer ✓ |
| Revocation | **No** access deny list (F5) |

---

## 3.3 Session management — checklist

| Check | Result |
|-------|--------|
| Storage | SHA-256 hash only ✓ |
| Rotation | **No** (F6) |
| Concurrent sessions | **No limit** |
| Logout | One session by refresh hash ✓ |
| Fixation | Opaque refresh in body, not URL — **low risk** |
| IP/UA binding | Stored, **not enforced** on refresh |

---

## 3.4 Authentication endpoints — checklist

| Endpoint | Rate limit | Enumeration | Audit |
|----------|------------|-------------|-------|
| register | **No** | EMAIL_EXISTS (F13) | `auth.register` ✓ |
| login | **No** (F1) | Inactive message (F12) | success only (F17) |
| refresh | **No** | N/A | **No** |
| logout | N/A | N/A | `auth.logout` ✓ |
| password-reset/* | **No** (F1) | request generic ✓ | partial (`auth.password_reset` on confirm) |
| me | N/A | N/A | N/A |
| CSRF | N/A (Bearer header) | | |

---

## 3.5 Registration & signup_slug — checklist

| Check | Result |
|-------|--------|
| `signup_ref` | `SELECT id FROM user_groups WHERE signup_slug = $1 AND status = 'active'` (`auth.rs:788–792`) — **enumerable slugs** assign group |
| Default role | SQL literal `'user'` (`auth_service.rs:149`) ✓ |
| Email verification | `email_verified = false` — **not required** (account squatting / spam) |
| Self-referral | Cannot use own not-yet-created referral code; referrer group inheritance OK |

---

## 3.6 RBAC — checklist

**`check_permission` (paste):**

```21:68:backend/auth-service/src/utils/permission_check.rs
pub async fn check_permission(...) -> Result<(), PermissionDenied> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    // ... profile_id required, EXISTS on permission_profile_grants with $1 $2 binds
}
```

| Check | Result |
|-------|--------|
| SQL injection via permission_key | **No** — bound parameter `$2` ✓ |
| NULL profile | Denied with FORBIDDEN ✓ |
| Admin bypass | **Full bypass** (F10) |
| Cache invalidation | **No cache** in check — always DB ✓ |
| `check_permission_profile_only` | Stricter for `admin`; only `kyc:approve` ✓ |

---

## 3.7 Scoped access — checklist

**`resolve_allowed_group_ids` (`scoped_access.rs:30–168`):**

- `super_admin` + `admin` **without** `managers` row → `Ok(None)` all groups ✓ (per comment)
- Manager with row, no tags → `Ok(Some(vec![]))` ✓ fail-closed
- Tags → groups via `tag_assignments` ✓

**Gap:** `admin_users.rs` **does not call** these helpers (F3). `auth.rs` list users has its own resolver (F15).

---

## 3.8 Impersonation — checklist

See F8. **`users:view` not required — `users:edit` only.** No impersonator claim. No shorter TTL.

---

## 3.9 Admin user mutations — checklist

| Action | Permission | Scoped | Self-protection |
|--------|------------|--------|-----------------|
| profile | `users:edit` | **No** | **No** |
| group | `users:edit_group` | **No** | **No** |
| role | `users:edit` | **No** | Can change other admins; only target must already be admin/super_admin |
| impersonate | `users:edit` | **No** | **No** |
| permission profile | `users:edit` | **No** | **No** |

Role strings validated on some fields; `update_user_role` only allows `admin`/`super_admin` on existing admins.

---

## 3.10 Manager CRUD — checklist

- Create: `managers:create`; can set `role` to `admin` (F11); any valid `permission_profile_id` including powerful profiles
- Delete/orphan: manager row deleted; user `permission_profile_id` may remain (verify delete handler — not fully audited; **medium risk**)

---

## 3.11 Token edge cases — checklist

| Scenario | Result |
|----------|--------|
| Deleted user + valid JWT | **Still accepted** until exp (F9) |
| Profile changed mid-session | Enforced only on routes that re-query DB; JWT role unchanged |
| Role changed | Access token stale until refresh (see 3.11) |
| After password reset | Sessions **not** revoked (F7) |

---

## 3.12 Cryptography — checklist

| Check | Result |
|-------|--------|
| JWT secret | F4 |
| RNG | Password salt: `OsRng` ✓; refresh: `thread_rng` ✓; OTP: `thread_rng` (F14) |
| TLS | Assumed at reverse proxy — **cannot determine** termination from auth code alone |
| Constant-time OTP compare | SHA-256 hash compare — OK; brute force is issue (F1) |

---

## 3.13 Information disclosure — checklist

See F12, F13, F16. `/me` returns full user + permissions (appropriate for self).

---

## 3.14 Rate limiting — checklist

**No implementation** on auth endpoints (F1). AI modules only.

---

## 3.15 Audit trail — checklist

| Event | Recorded? |
|-------|-----------|
| register | `audit_logs` + `user_events` ✓ |
| login | ✓ |
| login failed | **No** (F17) |
| logout | ✓ |
| password reset confirm | `user_events` only |
| impersonate | `user_events` only (F8) |
| role/profile change | **Not consistently verified** in admin_users handlers |

`audit_logs` tampering: no user-facing delete endpoint found in scope — **low risk**.

---

## 3.16 SQL safety — checklist

Searched `format!` + SQL in scope route files: **no dynamic SQL concatenation found** in `auth.rs`, `admin_users.rs`, `scoped_access.rs`. Search uses bound `ILIKE $3` patterns (`auth_service.rs:571–607`). **No issue found** for injection via permission_key or filters.

---

## 3.17 Error handling — checklist

| Location | Severity |
|----------|----------|
| `auth_service.rs:819` `unreachable!()` | Medium (F21) |
| `auth.rs:820` `unwrap_or(false)` on referral path | Low |
| Middleware maps all verify errors to 401 | OK |

Panics from malformed JWT input: caught as 401, not panic ✓

---

## 3.18 Test coverage — checklist

| Area | Tests |
|------|-------|
| password/JWT/permission_check/scoped_access | **None** in scope |
| Integration auth flows | **None** found |
| `utils/client_ip.rs`, `device_from_ua.rs` | Unit tests only |

---

# 4. Strengths

- **Argon2** password hashing with random salt (`utils/hash.rs`).
- **Refresh tokens stored hashed**; opaque high-entropy generation (32 bytes).
- **Password-reset request** returns generic message when email unknown (`auth.rs:386–391`).
- **Permission keys validated** against `permissions` table on profile update (`validate_permission_keys`).
- **Full Access profile** delete/rename guarded (`admin_permission_profiles.rs`).
- **`check_permission_profile_only`** correctly requires profile grant for `admin` on sensitive KYC actions.
- **Tag-based scoping helpers** fail closed when manager has no tags (`scoped_access.rs:143–144`).
- **SQLx parameter binding** used consistently in audited paths.
- **User events** capture IP/UA on register/login/logout/impersonate when handlers pass them.

---

# 5. Trust Score Breakdown

| Dimension | Score | Justification |
|-----------|------:|---------------|
| Authentication strength | 4 | Good hashes; no rate limits; OTP in logs |
| Authorization correctness | 3 | Admin bypass; admin routes unscoped |
| Session management | 4 | No rotation; no global revoke on reset |
| Cryptographic hygiene | 5 | Argon2/SHA256; dev JWT fallback |
| Audit trail completeness | 5 | Partial; failed login missing |
| Information disclosure resistance | 4 | Register/login leaks |
| Rate-limiting / brute-force | 2 | Absent on auth |
| Test coverage | 1 | No auth unit/integration tests |
| SQL safety | 8 | Parameterized queries |
| Error/panic safety | 6 | Few panics; mostly mapped errors |

**Harmonic mean ≈ 3.8 → Overall 4/10**

---

# 6. Production Go-Live Verdict

## 🔴 **Not ready**

Auth flaws directly enable account takeover (OTP/login brute force, impersonation IDOR) and undermine the entire platform including the order engine (forged or stolen JWTs, scoped managers accessing any user). Conditional go-live is inappropriate until F1–F4 and F3 are remediated and covered by tests.

---

# 7. Prioritized Fix List

| # | Finding | Effort | Risk if not fixed | Sprint |
|---|---------|--------|-------------------|--------|
| 1 | F1, F14 — Rate limits on login, OTP verify, refresh | M | Account takeover | 1 |
| 2 | F2 — Stop logging OTP/secrets | S | Log-based takeover | 1 |
| 3 | F3 — Scope all `admin_users` `:id` routes | M | IDOR / impersonation | 1 |
| 4 | F4 — Fail fast without `JWT_SECRET` in prod | S | Forged JWTs | 1 |
| 5 | F7, F5 — Revoke sessions on password reset; session version | M | Persistent compromise | 2 |
| 6 | F6 — Refresh token rotation + reuse detection | M | Long-lived token theft | 2 |
| 7 | F8 — Harden impersonation (permission, claim, audit) | M | Support abuse | 2 |
| 8 | F9, F10 — Middleware DB/status check; narrow admin bypass | L | Disabled users trade | 2 |
| 9 | F11 — Restrict who can grant `admin` role | S | Privilege escalation | 2 |
| 10 | F12, F13 — Uniform auth error messages | S | Enumeration | 3 |
| 11 | F17, F18 — Failed-login audit + IP in audit_logs | S | No forensics | 3 |
| 12 | Integration tests (login, reset, impersonate, scope) | L | Regressions | 1–ongoing |

---

# 8. Cross-Module Notes (external implications)

| Finding | External impact |
|---------|-----------------|
| F3 (no admin scoping) | **Finance** (`deposits`, `withdrawals`), **orders**, **AI chat/reports**, **chat**, **KYC** — if they use `check_permission` only without `ensure_user_in_allowed_groups`, same IDOR pattern likely |
| F5/F9 (JWT trust) | **order-engine** trusts `user_id` from NATS payloads issued by auth-service — forged JWT at API layer enables arbitrary trading commands |
| F8 (impersonation) | Full terminal/trading as user with no engine-side restriction |
| F4 (JWT secret) | **ws-gateway** and other services verifying same secret — shared blast radius |
| No email verification | Marketing spam; harder to prove identity for compliance |

---

*End of audit. Static analysis only; brute-force thresholds and TLS termination require runtime/infra confirmation.*
