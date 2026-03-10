# How Netting Mode Affects Positions

This doc explains **where** netting is implemented and **how it changes position behavior** (reduce / close / flip) compared to hedging.

---

## Root cause of “new position per order” in netting (fixed)

**Symptom:** In netting mode, every order for the same symbol opened a new position instead of merging (same side) or reducing/closing/flipping (opposite side).

**Cause:** In `atomic_fill_order.lua`, same-side merge was **disabled for everyone** with `if false and (... same side ...)`. So:

- **Same side (e.g. Buy then Buy):** The script never added to an existing position; it always fell through to “create new position.” In netting, same-side should **merge** into one position.
- **Opposite side:** The netting block was correct; it only runs when `account_type == "netting"`. If you still saw new positions on opposite side, ensure the order has `account_type: "netting"` (e.g. core-api and auth-service both load it from `users.account_type`).

**Fix (no change to hedging):**

1. **Same-side merge only when netting**  
   The condition was changed from `if false and (...)` to `if (account_type == "netting") and (... same side ...)` in all three places (new-format loop, old-format in main loop, old-format in `old_positions` loop).  
   - **Netting:** Same symbol + same side → add to existing position (one net position per symbol).  
   - **Hedging:** Unchanged; no same-side merge, one position per order.

2. **Robust `order.side` handling**  
   A normalized `order_side` (`"BUY"` or `"SELL"`) is derived from `order.side` (accepting `"BUY"`/`"Buy"` and `"SELL"`/`"Sell"`) and used for all position logic so comparisons are consistent.

---

## 1. What Netting vs Hedging Means

| Mode     | Meaning |
|----------|--------|
| **Hedging** | Multiple positions per symbol. Buy 1 BTC then Sell 1 BTC → you have **two** positions (1 Long, 1 Short). |
| **Netting** | One **net** position per symbol. Buy 1 BTC then Sell 1 BTC (same size) → the Sell **closes** the Long; you end with **no** open position (or one position if sizes differ). |

So **netting mode** directly affects **how a new fill is applied to positions**: it can **reduce**, **fully close**, or **flip** an opposite-side position instead of always opening a new one.

---

## 2. Where Netting Is Decided

- **User setting:** `users.account_type` in the DB (`'hedging'` or `'netting'`).
- **Order command:** When placing an order, the service (auth-service or core-api) must send `account_type` in `PlaceOrderCommand`. The order-engine stores it on the order and passes it into the **Lua fill script**.
- **Lua script:** `apps/order-engine/lua/atomic_fill_order.lua` is the only place that **implements** netting. It reads `order.account_type` and, when it is `"netting"`, runs the **netting block** that reduces/closes/flips the opposite position.

So: **netting only affects positions when the order has `account_type == "netting"` and the fill is applied in that Lua script.**

---

## 3. How the Lua Script Uses Netting (Position Effects)

File: **`apps/order-engine/lua/atomic_fill_order.lua`**

### 3.1 Account type (L49–53)

```lua
-- Account type: hedging = multiple positions per symbol; netting = one net position per symbol
local at = order.account_type or order.accountType
local account_type = (at == "netting") and "netting" or "hedging"
```

If the order doesn’t have `account_type == "netting"`, the script treats it as hedging and **never** runs the netting logic below.

### 3.2 When does netting run?

- The script first looks for a **same-side** position to add to (that path is currently **disabled** for both hedging and netting; see `if false and ...` around L85).
- So in practice it only **creates a new position** or (if netting) **reduces/closes/flips an opposite position**.

**Netting block (L310–317):**

```lua
-- Netting: if no same-side position found, try to reduce/close/flip opposite-side position (one per symbol)
if not position_id and account_type == "netting" then
```

So netting runs only when:

1. No same-side position was used yet (`position_id` is still `nil`).
2. `account_type == "netting"`.

Then it loops over the user’s open positions for that symbol and looks for an **opposite** side (e.g. order is BUY, position is SHORT).

### 3.3 Three position outcomes in netting (L311–417)

For an **opposite** open position of size `pos_size` and a fill of `fill_size_num`:

- **`close_size = min(pos_size, fill_size_num)`**
- **`new_size = pos_size - fill_size_num`**

| Case            | Condition     | Effect on position |
|-----------------|---------------|---------------------|
| **Reduce**      | `new_size > 0`  | Same position stays OPEN; `size` and `margin` reduced, `realized_pnl` updated. `fill_action = "reduced"`. |
| **Full close**  | `new_size == 0` | Position set to CLOSED, removed from open sets/indexes, margin released. `fill_action = "closed"`. |
| **Flip**        | `new_size < 0`  | Old position CLOSED and removed; a **new** position is created with the **opposite** side and size `-new_size` at the fill price. `fill_action = "flipped"`. |

So:

- **Reduce:** one position, smaller size, more realized PnL.
- **Full close:** that position disappears from open positions; margin and PnL are finalized.
- **Flip:** one position is closed and a new opposite position is opened in one atomic step.

---

## 4. What the Lua Script Returns (Rust uses this)

The script returns a JSON result that includes:

- `fill_action`: `"created"` | `"added_to"` | `"reduced"` | `"closed"` | `"flipped"`
- `position_id`: the position that was created, or (for netting) the one that was reduced, or the **new** position id after a flip
- `closed_position_id`, `closed_position_size`, `closed_position_side`: set when a position was **fully closed** or **flipped**
- `realized_pnl`: PnL from the fill (especially when reducing/closing)

So **netting affects positions** by making the Lua script return `fill_action` in `reduced` / `closed` / `flipped` and by updating/removing/creating positions inside Redis as above.

---

## 5. How the Order-Engine (Rust) Reacts to Netting Results

The engine does **not** re-implement netting; it only **reacts** to the Lua result.

### 5.1 Order handler (command path)

**File:** `apps/order-engine/src/engine/order_handler.rs` (around L258–320)

- Reads from Lua result: `fill_action`, `position_id`, `closed_position_id`, `closed_position_side`, `realized_pnl`, etc.
- **Netting – position closed (full close or flip):**  
  If `closed_position_id` is present, it publishes **`EVENT_POSITION_CLOSED`** and updates Redis/position events for that closed position.
- **Position opened:**  
  If `fill_action == "created"` it publishes `EVENT_POSITION_OPENED`; if `fill_action == "flipped"` it loads the new position from Redis and publishes `EVENT_POSITION_OPENED` for the new (flipped) position.

So: **netting affects positions** by causing the engine to emit position-closed and (on flip) position-opened events and to update state accordingly.

### 5.2 Tick handler (market fill path)

**File:** `apps/order-engine/src/engine/tick_handler.rs` (around L241, L286–326)

- Same idea: reads `fill_action`, `closed_position_id`, `position_id`, etc. from the Lua result.
- **Netting:** publishes `EVENT_POSITION_CLOSED` when `closed_position_id` is set (L286–303).
- Publishes `EVENT_POSITION_OPENED` when `fill_action` is `"created"` or `"flipped"` (L307–333).

So both the **command path** and the **tick path** only reflect what the Lua script did; netting’s effect on positions is fully decided in Lua.

---

## 6. End-to-end: how netting affects positions

1. **Order is placed** with `account_type: "netting"` (from auth-service or, after the fix, from core-api using `users.account_type`).
2. **Order-engine** stores the order (including `account_type`) and, on fill, calls the **Lua script** with that order.
3. **Lua** (`atomic_fill_order.lua`):
   - Sets `account_type = "netting"` when `order.account_type == "netting"`.
   - If no same-side position is used and `account_type == "netting"`, it finds an opposite open position and:
     - **Reduces** it (smaller size, updated margin and realized PnL), or
     - **Closes** it (status CLOSED, removed from open sets), or
     - **Flips** it (close old + create new opposite position).
4. **Rust** (order_handler / tick_handler) reads the Lua result and:
   - Publishes **position closed** when `closed_position_id` is set (netting full close or flip).
   - Publishes **position opened** when a new position was created or flipped.

So **netting mode affects positions** by:

- **Reduce:** one open position shrinks; margin and realized PnL updated; no new position.
- **Full close:** one position is removed from open positions; margin released; closed event published.
- **Flip:** one position closed, one new opposite position opened; both events published.

All of this is **per symbol**, **one net position per symbol** in netting mode, and only when the order carries `account_type: "netting"` into the Lua script.
