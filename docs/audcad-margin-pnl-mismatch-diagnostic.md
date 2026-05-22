# AUDCAD margin / P&L / footer / precision — diagnostic (Hetzner production)

**Reported symptoms:** Two open AUDCAD longs, UI showed **0.01 lots** each, similar **$0.71** entry/current, margins **$49.26** vs **$25.00**, P&L **-$0.20** vs **-$0.11**, footer **Margin $53.81** vs naive sum of row margins **$74.26**, forex precision concerns.

**Data source:** Read-only queries executed **2026-05-23** against **production** on Hetzner (`ptf.interwarepvt.com`): `ssh` → `/opt/newpt` → `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec` on **Postgres** and **Redis**.

---

## Executive summary (evidence-backed)

| Symptom | Root cause (production + code) |
|--------|----------------------------------|
| **Different margin ($49.26 vs $25)** | **Different filled `size` in base units** (1000 vs **507.52**), **same leverage (20)**. Margin = `size × entry / leverage` in **CAD**; values match formula. |
| **Different P&L at same “price”** | Live P&L in UI ∝ **`size`** (`openPositionPnlParts`); smaller position → smaller magnitude. Stored `pnl` in DB was **0** at query time; screenshot used **live tick** path. |
| **Footer margin ≠ sum of row numbers** | Row margins are **CAD**; footer **`marginUsed`** sums **USD** after `convert_with_rates`. **74.2579 CAD → ~53.80 USD** using snapshot `CAD: 1.3801` (CAD per USD). Naive **49.26+25.00** wrongly treats CAD as additive USD. |
| **Both show “0.01 lots”** | Symbol **`volume_precision: 2`**. **507.52 / 100000 = 0.0050752 lots** → rounds to **0.01** with two decimal places; **1000 / 100000 = 0.01** lots. **Display rounds two different true lot sizes to the same label.** |
| **“$0.71” vs pip precision** | Production DB **`entry_price` ~ 0.98516** (not 0.71). Screenshot **0.71** likely **USD-equivalent after FX** in UI, or different capture; DB/code use **quote (CAD)** + `formatConv` / `Intl` currency decimals — see Step 9. |

**Primary hypothesis supported:** **Hypothesis D — underlying `size` differs; “0.01 lots” for both is a rounding/display artifact**, not different leverage tiers for these two rows.

---

## Step 1 — Raw database state (production)

### 1.1 Query

```sql
SELECT p.id, p.user_id, p.symbol_id, p.side::text, p.size, p.entry_price, p.mark_price,
       p.leverage, p.margin_used, p.margin_from_cash, p.margin_from_bonus,
       p.status::text, p.opened_at, p.updated_at,
       p.accumulated_swap_usd, p.accumulated_fees_usd, p.pnl, p.pnl_percent,
       s.code AS symbol_code, s.quote_currency
FROM positions p
JOIN symbols s ON s.id = p.symbol_id
WHERE p.id::text LIKE 'e1684bc8%' OR p.id::text LIKE '5b65c9a3%'
ORDER BY p.opened_at;
```

### 1.2 Production result (two rows)

| Field | Position **5b65c9a3-…bf02** | Position **e1684bc8-…4deb** |
|--------|---------------------------|------------------------------|
| **id** | `5b65c9a3-2992-476b-8bfb-14733c55bf02` | `e1684bc8-5552-4d24-bea4-e8e1bf154deb` |
| **user_id** | `3bc1c0fd-8862-4239-a892-ecb16c4f4de0` | same |
| **side** | long | long |
| **size** | **507.52000000** | **1000.00000000** |
| **entry_price** | 0.98518000 | 0.98516000 |
| **mark_price** | 0.98518000 | 0.98516000 |
| **leverage** | **20** | **20** |
| **margin_used** | 24.99992768 | 49.25800000 |
| **margin_from_cash** | 24.99992768 | 49.25800000 |
| **pnl** | 0.00000000 | 0.00000000 |
| **opened_at** | `2026-05-22 20:20:10.72335+00` | `2026-05-22 20:20:41.223504+00` |
| **symbol / quote** | AUDCAD / **CAD** | AUDCAD / **CAD** |

### 1.3 Consistency check (formula)

Code: `margin_used = (size * entry_price) / leverage` (`position_event_handler.rs`).

- **Row 1:** `507.52 × 0.98518 / 20 = 24.99992768` → matches **margin_used**.
- **Row 2:** `1000 × 0.98516 / 20 = 49.258` → matches **margin_used**.

**Conclusion:** There is **no leverage mismatch** between these two positions on the server; **size differs** (~1.97×), which explains **margin ratio** ~49.26/25.00.

### 1.4 Lots implied (AUDCAD `contract_size`)

Production `symbols` for AUDCAD:

| contract_size | lot_min | volume_precision | digits | price_precision |
|---------------|---------|------------------|--------|-----------------|
| **100000**    | 0.01    | **2**            | 2      | **5**           |

- **1000 base** = **1000 / 100000 = 0.01** lots.
- **507.52 base** = **507.52 / 100000 = 0.0050752** lots → with **2** decimal volume display rounds to **0.01** lots.

This explains the screenshot showing **0.01 lots for both** while economics differ.

---

## Step 2 — Leverage profile / tiers (production)

**User row:** `cokykod@mailinator.com`, `group_id` `2b5d78a7-4b78-423a-b093-ee82def43121`, **`leverage_profile_id` NULL** on `users`, **`margin_calculation_type` = `hedged`**.

**Group + symbol:** `group_symbols` for this group + AUDCAD → **`leverage_profile_id` = `f4353a28-929a-44fd-a9e4-152ed8281b57` (`Lev1`)**.

**`leverage_profile_tiers` (Lev1):**

| tier_index | notional_from | notional_to   | max_leverage | updated_at           |
|------------|---------------|---------------|--------------|----------------------|
| 1          | 0             | 10000000      | **20**       | 2026-04-27 20:49:32Z |

Single open-ended band → both notionals map to **max leverage 20** (clamped by user min/max 1–500).

**Conclusion:** **No tier boundary split** between the two fills; **not** hypothesis “different tier between 22:20:07 and 22:20:38” for this user/symbol on current data.

---

## Step 3 — Tier / profile edits in the 31s window

`leverage_profile_tiers` for **Lev1** last updated **2026-04-27** — **not** between the two order times (`2026-05-22 20:20:07Z` / `20:20:38Z`).

**Conclusion:** **Hypothesis B (admin edited tiers between placements)** is **refuted** for this incident (for the profile actually used).

---

## Step 4 — Orders that opened the positions (production)

```sql
SELECT id, side::text, type::text, size, margin_from_cash, status::text, created_at, filled_at
FROM orders
WHERE user_id = '3bc1c0fd-8862-4239-a892-ecb16c4f4de0'
  AND created_at BETWEEN '2026-05-22 20:19:00+00' AND '2026-05-22 20:22:00+00'
ORDER BY created_at;
```

| id (prefix) | size     | margin_from_cash | created_at (UTC) | filled_at (UTC) |
|-------------|----------|------------------|------------------|-----------------|
| `485250f3-…` | **507.52** | 24.99992768    | 20:20:07.906957  | 20:20:10.722691 |
| `6a2bfb4d-…` | **1000**   | 49.25800000    | 20:20:38.819597  | 20:20:41.222847 |

**`leverage_used`** column was **NULL** on both `orders` rows in this dump (column exists; not populated on insert in this build — **separate data-quality note**, not needed to explain margin math).

**Conclusion:** The engine persisted **different order sizes** from the start; this is **not** a post-fill Redis/Postgres divergence for size between order and position.

**Next engineering question (not answered here):** Why did the **first** market order request result in **507.52** base units (≈0.0051 lots) vs **1000** (0.01 lots)? Trace **terminal payload / slippage / size pipeline** for order `485250f3-e010-42e5-9af6-1298ab561ae1`.

---

## Step 5 — Code paths (`orders.rs` vs `admin_trading.rs` vs `core-api`)

Unchanged from code review:

- **Auth** `orders::place_order` and **`admin_trading::create_order`** both use **`compute_order_margin_details`** and pass **`leverage_tiers`** into `PlaceOrderCommand` when publishing to NATS.
- **`core-api`** still builds commands with **`leverage_tiers: None`** (`apps/core-api/src/handlers.rs` ~146) — **not** the path these two rows came through if fills succeeded with tiered leverage.

**Conclusion:** For this incident, **Hypothesis C (admin vs user tier resolution)** is **weak**; evidence points to **different submitted/filled size**, not different tier tables between the two auth paths.

---

## Step 6 — P&L: DB vs UI

**DB `pnl`:** **0** for both positions at query time.

**UI open row** (`openPositionPnlParts` in `src/shared/components/PositionPnLBreakdown.tsx`): with a live bid/ask, **market PnL** uses `(livePrice - entryPrice) * sizeNum` for LONG — scales with **`sizeNum`**. So **~2× size** ⇒ **~2×** move for the same price tick → matches **~-$0.20** vs **~-$0.11** **if** `formatSigned` is treating that number as **USD display** while the product is in **quote** (same **unit mismatch** theme as margin row display; see Step 8).

---

## Step 7 — Redis `pos:by_id` (production)

**`HGETALL pos:by_id:5b65c9a3-2992-476b-8bfb-14733c55bf02`** (abridged):  
`size=507.52`, `entry_price=0.98518`, `leverage=20`, `margin=24.99992768`, `symbol=AUDCAD`, `group_id=2b5d78a7-…`, `status=OPEN`, `unrealized_pnl=0`, …

**`HGETALL pos:by_id:e1684bc8-5552-4d24-bea4-e8e1bf154deb`:**  
`size=1000`, `entry_price=0.98516`, `leverage=20`, `margin=49.258`, …

**Conclusion:** **Postgres and Redis agree** for these fields — **no** Redis-vs-DB skew for this pair.

---

## Step 8 — Footer aggregation vs row margin

**Redis FX snapshot** (`GET fx:rates:usd`), includes `"CAD":"1.3801"` (same convention as `fx_rates::convert_with_rates`: **amount × rate_to / rate_from**; rates are per **USD** anchor — see `backend/auth-service/src/services/fx_rates.rs`).

**CAD notionals:**

- Sum **margin_used** (CAD): `49.258 + 24.99992768 = 74.25792768` CAD.

**USD:**

- `74.25792768 × (1 USD rate) / (1.3801 CAD per USD)` = **74.25792768 / 1.3801 ≈ 53.80 USD** → matches **footer ~$53.81** (rounding / snapshot time).

**Row UI:** `BottomDockOpenPositionRows` uses **`formatMoney` = `useFormatFromUsd()`** on `pos.margin` — **treats CAD margin numerals as if they were USD** for formatting label path; **`compute_account_summary_inner`** correctly converts **CAD → USD** (`deposits.rs` `fetch_position_aggregates_from_redis`).

**Conclusion:** **Bug #3 resolved:** footer is **correct USD**; naive sum of **row numbers** mixes **units** (and mislabels them as “$” via the wrong formatter).

---

## Step 9 — Display precision (entry / current)

- **DB** stores **5** dp prices for this symbol (`price_precision=5`); **`digits=2`** is legacy/confusing for FX.
- **Terminal** open row uses **`formatConv(price, posQuote)`** → `formatAmount` / **Intl** by **currency**, not by **`price_precision`**.
- **`RightTradingPanel`** can show **more** decimals via **`quoteFractionDigits`** from tick strings (`RightTradingPanel.tsx` ~107).

**Conclusion:** **Bug #4** is largely **“FX price shown as money in quote currency with ISO decimal rules, not as a raw pip string”** — plus screenshot may not match raw **0.985xx** DB values.

---

## Step 10 — Verdict table (updated)

| Hypothesis | Supported? | Evidence |
|------------|------------|----------|
| **A** Non-deterministic leverage | **No** | Same **leverage 20**; `effective_leverage` deterministic. |
| **B** Tier edited between fills | **No** | Tier **`updated_at` April 2026**; orders **May 2026**. |
| **C** orders.rs vs admin_trading | **Unlikely** | Same margin pipeline; orders show **different `size`**, not different profile. |
| **D** DB sizes differ; UI lies | **Yes** | **507.52 vs 1000**; **volume_precision 2** rounds **0.0050752** lots to **0.01**. |
| **E** Multiple bugs | **Partially** | **#1+#2** from **size** (+ live PnL scaling); **#3** from **CAD vs USD** + wrong row formatter; **#4** formatting policy. |

---

## Recommended next steps

1. **Product / risk:** Decide whether **0.0050752** lots should be **displayable** (raise **`volume_precision`** for FX symbols, or show **base units** + lots with **more** decimals).
2. **Terminal:** Fix **`formatMoney(pos.margin)`** — margin is **quote notional / leverage** → format in **quote** or convert with same FX as account summary, not **`useFormatFromUsd`**.
3. **Investigate order `485250f3-…`:** Why **`size=507.52`** was accepted/stored (client payload, slippage, unit conversion, partial logic).

---

## Appendix — Commands used (replay)

```bash
ssh root@ptf.interwarepvt.com
cd /opt/newpt
# Postgres
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T postgres \
  psql -U postgres -d newpt -c 'SELECT ...'
# Redis
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
  redis-cli HGETALL "pos:by_id:<uuid>"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T redis \
  redis-cli GET "fx:rates:usd"
```
