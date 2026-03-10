# Netting Mode Not Working – Solution Plan

**Status:** Proposal (awaiting your review)  
**Goal:** Make netting mode work correctly when orders are placed, without breaking existing functionality.

---

## 1. Problem Summary

**Expected (netting mode):**  
User opens 1 BTC Long → then 1 BTC Short (same size). The second order should **fully close** the first position, release margin, and leave **no open position**.

**Observed:**  
Behavior matches **hedging** instead: two separate positions or margin not released (depending on which API is used).

**Root cause:**  
Orders sent to **core-api** (`/v1/orders` on port 3004) use a **hard-coded** `account_type: "hedging"` in the `PlaceOrderCommand`. The order-engine and Lua script never see `"netting"`, so the netting logic (reduce/close/flip opposite position) is never used.

- **Auth-service** (port 3000): reads `users.account_type` and sends it in the command → **netting works** when this path is used.
- **Core-api** (port 3004): always sends `account_type: "hedging"` → **netting never applies** for this path.

---

## 2. Scope and Principles

- **Fix:** Ensure `account_type` is correct for **core-api** so netting works no matter which service receives the order.
- **Do not change:** Auth-service, order-engine, Lua script, or frontend contract (request/response).
- **Do not disturb:** Hedging users, existing order/position flows, idempotency, or other core-api endpoints.

---

## 3. Proposed Solution

### 3.1 Core-API: Use Real User and Real `account_type`

**File:** `apps/core-api/src/handlers.rs`

**Current (problem):**

```rust
// TODO: Extract user_id from JWT token
let user_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")...
// ...
account_type: Some("hedging".to_string()), // always hedging
```

**Change:**

1. **Extract user from JWT** (same pattern as in `apps/core-api/src/deposits.rs`):
   - Add `Extension(claims): Extension<Claims>` to `place_order` (and `cancel_order`).
   - Use `user_id = claims.sub` instead of the hard-coded UUID.

2. **Load `account_type` from DB** (core-api already has `state.db`):
   - Before building `PlaceOrderCommand`, run:
     - `SELECT COALESCE(account_type, 'hedging') FROM users WHERE id = $1`
   - Allow only `"hedging"` or `"netting"` (same rule as auth-service); otherwise default to `"hedging"`.

3. **Pass into command:**
   - Set `account_type: Some(account_type_from_db)` in `PlaceOrderCommand` (no leverage tiers or group_id required for this fix; leave as today).

**Optional but recommended:**  
Apply the same `Extension(Claims)` + `user_id = claims.sub` in `cancel_order` and `list_orders` so all order endpoints use the authenticated user (and behavior stays consistent).

---

### 3.2 Behavior After the Change

| Scenario | Before | After |
|----------|--------|--------|
| User **netting**, order via **auth-service** | Netting works | Unchanged (netting works) |
| User **netting**, order via **core-api** | Hedging (wrong) | Netting works |
| User **hedging**, order via **auth-service** | Hedging works | Unchanged |
| User **hedging**, order via **core-api** | Hedging works | Unchanged |
| User has `account_type = NULL` or invalid | Treated as hedging | Still default to hedging |

No change to:
- Order-engine or Lua (they already respect `order.account_type`).
- Auth-service (already sends correct `account_type`).
- Frontend or API contract.

---

## 4. Implementation Checklist

- [ ] **handlers.rs – place_order**
  - [ ] Add `Extension(claims): Extension<Claims>`.
  - [ ] Use `user_id = claims.sub`.
  - [ ] Query DB for `account_type` for this `user_id` (default `"hedging"` if missing or invalid).
  - [ ] Set `account_type: Some(account_type_from_db)` in `PlaceOrderCommand`.
- [ ] **handlers.rs – cancel_order**
  - [ ] Add `Extension(claims): Extension<Claims)` and use `user_id = claims.sub` (remove hard-coded UUID).
- [ ] **handlers.rs – list_orders**
  - [ ] If it uses a hard-coded user_id, switch to `Extension(claims)` and `claims.sub`.
- [ ] **Imports**
  - [ ] Ensure `Extension` and `Claims` are imported where used (see `deposits.rs` for pattern).
- [ ] **Tests / manual checks**
  - [ ] User with `account_type = netting`: place Buy then Sell same size via core-api → one position opened then closed, margin released.
  - [ ] User with `account_type = hedging`: place Buy then Sell via core-api → two positions (or add-to / new) as today.
  - [ ] Orders via auth-service: unchanged behavior for both netting and hedging.

---

## 5. Risk and Rollback

- **Risk:** Low. Only core-api request handling and one DB read are changed; order-engine and Lua are untouched.
- **Rollback:** Revert the core-api handler changes; netting will again only work when orders go through auth-service.

---

## 6. Optional: Routing Recommendation

Long term, prefer **one** place for placing orders (e.g. auth-service) so leverage, group_id, and account_type all come from the same source. Until then, fixing core-api as above ensures netting works regardless of which service the client calls.

---

## 7. Summary

- **Root cause:** Core-api forces `account_type: "hedging"`, so netting logic in the engine is never used for core-api orders.
- **Fix:** In core-api, use JWT `user_id` and DB `users.account_type` and pass that into `PlaceOrderCommand`.
- **Result:** Netting works for core-api path; hedging and auth-service behavior unchanged; no impact on other functionality.

Once you confirm this plan is acceptable, implementation can follow the checklist above.

---

## 8. Validation (Why This Plan Is Safe)

**Verified against the codebase:**

| Check | Result |
|-------|--------|
| **`users.account_type`** | Present in DB: `infra/migrations/004_account_type.sql` — column `account_type VARCHAR(20) NOT NULL DEFAULT 'hedging'` with CHECK `('hedging', 'netting')`. |
| **Core-api has DB + JWT** | `AppState` has `db: PgPool`; protected routes use `auth_middleware`; `deposits.rs` already uses `Extension(Claims)` and `claims.sub` on the same routes. |
| **Auth-service unchanged** | No edits to auth-service, order-engine, or Lua. They already behave correctly when `account_type` is set. |
| **API contract unchanged** | Request/response types for `POST/GET /v1/orders` and `POST /v1/orders/:id/cancel` stay the same; only server-side user resolution and one DB field read are added. |
| **Idempotency** | Still keyed by `(user_id, idempotency_key)`. Using real `user_id` from JWT keeps idempotency per user; no change in semantics. |
| **cancel_order / list_orders** | Today they use a hard-coded user UUID; switching to `claims.sub` makes them act on the **authenticated user**. This is a correctness fix (users see/cancel only their own orders), not a breaking change. |
| **Hedging users** | `account_type` from DB remains `"hedging"` for them; command is unchanged and behavior is unchanged. |
| **User missing from DB or NULL account_type** | Query can return no row or NULL; plan: use `COALESCE(account_type, 'hedging')` and default to `"hedging"` when row missing — same as auth-service. |

**Conclusion:** The change is scoped to core-api handlers only, uses existing auth and DB, preserves all current behavior for auth-service and hedging, and fixes netting for core-api without affecting other functionality.

---

## 9. 100% Guarantee – Verified Data Flow

**End-to-end chain (verified in code):**

| Step | Component | Verified |
|------|-----------|----------|
| 1 | Core-api `place_order` gets `Extension(claims)` from auth middleware (same as `deposits.rs`). | `main.rs` L79: protected routes use `auth_middleware`; `deposits.rs` L42–45 uses `Extension(claims)`, `claims.sub`. |
| 2 | `user_id = claims.sub` is the real authenticated user. | `auth.rs` L13–14: `Claims { sub: Uuid }`. |
| 3 | Query `SELECT COALESCE(account_type, 'hedging') FROM users WHERE id = $1` on `state.db`. | `AppState` has `db: PgPool`; `handlers.rs` L445 and `deposits.rs` already use `state.db`; `infra/migrations/004_account_type.sql` adds `users.account_type`. |
| 4 | If row missing or DB error → use `"hedging"` (no failure). | Implementation will use `.await.ok().flatten().unwrap_or("hedging".to_string())` so place_order never fails due to account_type. |
| 5 | `PlaceOrderCommand { account_type: Some(account_type_from_db), ... }` published to NATS. | `contracts::commands::PlaceOrderCommand` has `account_type: Option<String>` (L42–43). |
| 6 | Order-engine receives command, builds `Order { account_type: cmd.account_type.or_else(|| Some("hedging".to_string())) }`. | `order_handler.rs` L175. |
| 7 | Order stored in Redis as JSON: `serde_json::to_string(&order)` includes `account_type`. | `order_handler.rs` L181–185; `Order` has `account_type: Option<String>` with serde (models.rs L52–54). |
| 8 | Lua script reads `order = cjson.decode(order_json)` and `order.account_type == "netting"`. | `atomic_fill_order.lua` L19, L51; netting block L307. |

**Guarantees:**

- **If core-api sends `account_type: "netting"`** → order-engine stores it → Lua sees `order.account_type == "netting"` → netting block runs → opposite position is reduced/closed/flipped. **Netting works.**
- **If DB lookup fails or user missing** → we pass `"hedging"` → behavior identical to today. **No regression.**
- **Auth-service and order-engine/Lua** are unchanged; they already work. **No side effects.**
- **JWT is already required** for `/v1/orders` (middleware); we only read the existing `Claims`. **No new auth requirement.**
- **Invalid DB value:** If `account_type` is not `"hedging"` or `"netting"` (e.g. typo), implementation will normalize to `"hedging"` so the engine never receives an unknown value.

**Implementation will:** (1) Use real `user_id` from JWT and real `account_type` from DB; (2) On any DB error or missing/invalid value, default to `"hedging"` so `place_order` never fails because of this change; (3) Leave auth-service, order-engine, and Lua untouched. With that, the solution will work.
