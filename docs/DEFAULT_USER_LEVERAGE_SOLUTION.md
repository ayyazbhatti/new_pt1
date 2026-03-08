# Default min/max leverage for new users — solution

## Problem

When a new user registers, `min_leverage` and `max_leverage` are not set (NULL in DB). The trading terminal shows "Your min – max" as "—" and the hint "Set in Admin → Users (leverage column)" until an admin explicitly sets leverage in the Edit User popup on `/admin/users`.

## Root cause (summary)

- **Registration** (`auth_service.register`) INSERT does not include `min_leverage` or `max_leverage`; DB columns are nullable with no DEFAULT → new users get NULL.
- **GET /api/auth/me** returns the user row as-is; terminal displays whatever is returned → NULL means nothing to show.
- Only **Admin Edit User** (PATCH) writes these columns today.

---

## Recommended solution: set defaults at registration

Persist sensible default leverage when the user is created so the terminal shows a range immediately without admin action. This keeps a single source of truth (DB) and matches existing UI defaults (Edit User form uses 1 and 500 when user has no leverage).

### Default values

Use the same values already used in the admin Edit User form when leverage is unset:

- **min_leverage:** `1`
- **max_leverage:** `500`

(Adjust if your product standard is different; keep min ≤ max and within existing validation, e.g. 1–1000.)

---

## Implementation

### 1. Backend: set leverage on registration (required)

**File:** `backend/auth-service/src/services/auth_service.rs`

In `register()`, extend the INSERT to include default leverage:

- Add `min_leverage, max_leverage` to the column list.
- Add the corresponding values in the VALUES list (e.g. `1` and `500`), using constants in code (e.g. `1i32` and `500i32` or named constants).
- Keep `RETURNING *` so the returned `User` has the new columns set.

Example (conceptual):

```text
INSERT INTO users (
    email, password_hash, first_name, last_name, country,
    role, status, email_verified, referral_code, referred_by_user_id, group_id,
    min_leverage, max_leverage
)
VALUES ($1, $2, $3, $4, $5, 'user', $6, false, $7, $8, $9, $10, $11)
RETURNING *
```

- Use your project’s preferred style (raw numbers vs constants like `DEFAULT_MIN_LEVERAGE` / `DEFAULT_MAX_LEVERAGE`).
- In sqlx, use placeholders $10 and $11 and add `.bind(1i32).bind(500i32)` so the bind count matches.

**Result:** Every new user gets `min_leverage = 1` and `max_leverage = 500` at signup. No change to `/api/auth/me` or frontend required for the terminal to show "1 – 500×".

---

### 2. Optional: backfill existing users with NULL leverage

**File:** New migration, e.g. `database/migrations/XXXX_backfill_users_leverage_defaults.sql`

If you want existing users who still have NULL to show a range in the terminal without an admin editing them:

```sql
-- Backfill: set default leverage for users who have none
UPDATE users
SET min_leverage = 1, max_leverage = 500, updated_at = NOW()
WHERE min_leverage IS NULL AND max_leverage IS NULL;
```

- Run once; safe to re-run (idempotent for users that remain NULL).
- Omit if you prefer only new users to get defaults and existing users to keep NULL until an admin sets them.

---

### 3. Optional: database DEFAULT (future-proofing)

**File:** New migration, e.g. `database/migrations/XXXX_users_leverage_defaults.sql`

So that any future INSERT that omits these columns still gets defaults:

```sql
ALTER TABLE users
  ALTER COLUMN min_leverage SET DEFAULT 1,
  ALTER COLUMN max_leverage SET DEFAULT 500;
```

- Registration would then not strictly need to pass 1/500 in the INSERT (they’d come from DEFAULT), but including them in the INSERT is still recommended so the intent is explicit and the code is self-documenting.

---

## Validation: no impact on existing behaviour

Verified against the codebase so this change does not disturb any functionality:

| Area | Verification |
|------|--------------|
| **User model** | `User` has `min_leverage: Option<i32>` and `max_leverage: Option<i32>`. `RETURNING *` already returns these columns; adding them to the INSERT only sets values. No schema or type change. |
| **Admin Edit User** | PATCH accepts optional `min_leverage` / `max_leverage`. If admin sends only `group_id`, the UPDATE does not touch leverage columns. So: existing users with NULL stay NULL unless admin sets; new users with 1/500 can later be changed by admin. No conflict. |
| **Admin validation** | Leverage must be 1–1000 and min ≤ max. Values 1 and 500 are valid and pass validation if admin later sends them. |
| **GET /api/auth/me** | Returns `user.min_leverage` and `user.max_leverage` from the row. New users will return 1 and 500; existing NULL users unchanged. Frontend and terminal already handle both null and numbers. |
| **Order placement (auth-service)** | Reads `min_leverage`, `max_leverage` from DB and passes to order-engine. New users will send 1 and 500; order-engine clamps effective leverage to this range. |
| **Order-engine (leverage)** | When user has `Some(min)`, `Some(max)`, it clamps to that range. When NULL it uses 1.0 and 1000.0. Setting 1 and 500 at registration gives a tighter (more conservative) range; no breakage, same code path. |
| **Bulk create users** | `bulk_create_users` uses the same INSERT shape (no min/max today). Bulked users currently get NULL. For consistency you can add the same two columns and binds there in a follow-up; not required for registration fix. |

No changes are required to frontend, `/api/auth/me`, admin API, or order-engine logic; only the registration INSERT is extended.

---

## What not to do (for clarity)

- **Don’t** add default leverage only in the frontend (e.g. show "1 – 500×" when API returns null): the DB would still have NULL, admin views could show "not set", and order-engine/other consumers that read from DB would not see a default. Prefer persisting in the DB.
- **Don’t** add default leverage only in GET `/api/auth/me` (e.g. return 1 and 500 when null) unless you also document that "no value" is represented as 1/500 everywhere; persisting at registration keeps semantics consistent.

---

## Implementation checklist

- [ ] **auth_service.rs (register)**
  - [ ] Add `min_leverage` and `max_leverage` to the INSERT column list.
  - [ ] Add two bind values (e.g. 1 and 500) to the VALUES and to `.bind(...)`.
  - [ ] Confirm `RETURNING *` still returns the new columns (no type/schema change needed if columns already exist).
- [ ] **Optional: backfill migration**
  - [ ] Add migration that UPDATEs users with NULL leverage to 1 and 500.
  - [ ] Run migration in dev/staging and verify.
- [ ] **Optional: DB DEFAULT**
  - [ ] Add migration setting DEFAULT 1 and 500 for `min_leverage` and `max_leverage`.
- [ ] **Optional: bulk_create_users**
  - [ ] In `auth_service.bulk_create_users`, add `min_leverage` and `max_leverage` to the INSERT and bind 1 and 500 so bulk-created users also get defaults (consistency with register).
- [ ] **Manual test**
  - [ ] Register a new user; call GET `/api/auth/me` (or open terminal) and confirm `min_leverage: 1`, `max_leverage: 500`.
  - [ ] Open trading terminal as that user; confirm "Your min – max" shows "1 – 500×" without any admin edit.
  - [ ] Admin Edit User: change to e.g. 1–100, save; confirm terminal shows "1 – 100×" and that registration still creates new users with 1–500.

---

## Summary

| Change | Purpose |
|--------|--------|
| Set default leverage in `register()` INSERT | New users get min/max leverage at signup so the terminal shows a range by default. |
| Optional backfill migration | Existing users with NULL get 1 and 500 so they also see a range. |
| Optional DB DEFAULT | Future INSERTs that omit these columns still get 1 and 500. |

Using **1** and **500** aligns with the existing admin Edit User form defaults and keeps behaviour consistent across registration, terminal, and admin.
