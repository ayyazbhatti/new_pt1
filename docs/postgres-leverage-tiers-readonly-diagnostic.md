# PostgreSQL read-only diagnostic — leverage tiers vs `POST /v1/orders/estimate` 400

## How connection details were discovered

1. **`infra/docker-compose.yml`** — Service `postgres`, container name `newpt-postgres`, image `postgres:16-alpine`, `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` = `postgres` / `postgres` / `newpt`, host port **`5434:5432`**.
2. **`deploy/docker-compose.prod.yml`** — Skipped for live connection (prod uses internal hostname `postgres:5432`; dev target is local **5434**).
3. **Env examples** — `backend/auth-service/.env.example` documents `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/newpt`. Root `.env` was not present in the glob used for discovery; credentials match compose for local dev.
4. **`docker ps ... | grep -i postgres`** — Confirmed **`newpt-postgres`** listening on **`0.0.0.0:5434->5432/tcp`**.

**Connection method chosen:** Host `psql` to `127.0.0.1:5434` (not `docker exec`), because the port is published and `psql` is available on the host.

---

## 1. Connection details used

| Field | Value |
|--------|--------|
| **Method** | Host `psql` |
| **Host** | `127.0.0.1` |
| **Port** | `5434` |
| **Database** | `newpt` |
| **User** | `postgres` |
| **Password** | *(omitted from this report; matches `infra/docker-compose.yml`)* |
| **Container** | `newpt-postgres` (confirmed running) |

---

## 2. Query A results — all profiles

**Raw output:**

```
+--------------------------------------+---------------+------------+------------+----------------+----------------------+-----------------------+
|                  id                  |     name      | is_default | tier_count | top_tier_index | top_tier_notional_to | top_tier_max_leverage |
+--------------------------------------+---------------+------------+------------+----------------+----------------------+-----------------------+
| f4353a28-929a-44fd-a9e4-152ed8281b57 | Lev1          | t          |          1 |              1 |    10000000.00000000 |                    20 |
| 16668daa-a273-41ce-9722-791d4c6866ed | Heather Doyle | f          |          1 |              1 |       10000.00000000 |                    50 |
| e5b2f5c8-56c6-491a-b833-640c368e8e23 | Lev3          | f          |          0 |                |                      |                       |
| e908d56f-2fbc-4a76-a04a-a1ad30051a4c | Test Profile  | f          |          0 |                |                      |                       |
+--------------------------------------+---------------+------------+------------+----------------+----------------------+-----------------------+
(4 rows)
```

**Interpretation**

- **Four** leverage profiles exist.
- **Default profile:** **Lev1** (`is_default = t`, id `f4353a28-929a-44fd-a9e4-152ed8281b57`).
- **Lev1:** **One** tier; top `tier_index` = **1**; `top_tier_notional_to` = **10,000,000** (numeric, **not** NULL) → top band is **capped** at **$10M** notional (still covers notionals far above ~$400k).
- **Heather Doyle:** **One** tier; top `notional_to` = **10,000** → **hard cap at $10k** notional; **not** open-ended.
- **Lev3** and **Test Profile:** **zero** tiers (`tier_count = 0`) — unusable for `effective_leverage` until tiers exist.

---

## 3. Query B results — BTCUSDT resolution per group

**Raw output:**

```
+--------------------------------------+------------+---------+--------------------------------------+--------------------------------------+--------------------------+--------------------------------------+-----------------------+
|               group_id               | group_name | symbol  |              symbol_id               |       group_symbol_profile_id        | group_default_profile_id |         resolved_profile_id          | resolved_profile_name |
+--------------------------------------+------------+---------+--------------------------------------+--------------------------------------+--------------------------+--------------------------------------+-----------------------+
| 00000000-0000-0000-0000-000000000001 | Default    | BTCUSDT | 344b6f89-e22f-4fb4-928d-15652cddbb9c |                                      |                          |                                      |                       |
| 2b5d78a7-4b78-423a-b093-ee82def43121 | G1         | BTCUSDT | 344b6f89-e22f-4fb4-928d-15652cddbb9c | f4353a28-929a-44fd-a9e4-152ed8281b57 |                          | f4353a28-929a-44fd-a9e4-152ed8281b57 | Lev1                  |
| 514b95a3-c525-4d0f-ad11-bf151158f270 | G4         | BTCUSDT | 344b6f89-e22f-4fb4-928d-15652cddbb9c |                                      |                          |                                      |                       |
| 233f0f3b-6133-449c-99b3-f6ad66b6cefb | g3         | BTCUSDT | 344b6f89-e22f-4fb4-928d-15652cddbb9c |                                      |                          |                                      |                       |
| 97395b4b-4ed2-4b22-883a-de0398aca728 | g5         | BTCUSDT | 344b6f89-e22f-4fb4-928d-15652cddbb9c |                                      |                          |                                      |                       |
| 2c0d1715-222a-4413-8549-5b6b1956019d | g6         | BTCUSDT | 344b6f89-e22f-4fb4-928d-15652cddbb9c |                                      |                          |                                      |                       |
+--------------------------------------+------------+---------+--------------------------------------+--------------------------------------+--------------------------+--------------------------------------+-----------------------+
(6 rows)
```

**Interpretation**

- **G1:** Per-symbol assignment points **BTCUSDT** at profile **Lev1** (`resolved_profile_id` = `f4353a28-929a-44fd-a9e4-152ed8281b57`).
- **Default, G4, g3, g5, g6:** `COALESCE(group_symbol_profile_id, group_default_profile_id)` is **NULL** in this query (no `group_symbols.leverage_profile_id`, no `user_groups.default_leverage_profile_id` on file for those rows).

**Important (application behavior not in Query B):** `resolve_leverage_profile_id_for_user_symbol` in `backend/auth-service/src/routes/orders.rs` (lines **116–132**) loads `COALESCE(gs, ug.default)`; when that is **NULL**, it **falls back** to `SELECT id FROM leverage_profiles WHERE is_default = true LIMIT 1` → **Lev1** in this database. So for groups where Query B shows NULL, **runtime resolution is still Lev1** unless the user/symbol join fails (no row).

---

## 4. Query C results — all tiers, all profiles

**Raw output:**

```
+---------------+------------+------------+---------------+-------------------+--------------+------------------------+----------------------------+
| profile_name  | is_default | tier_index | notional_from |    notional_to    | max_leverage | initial_margin_percent | maintenance_margin_percent |
+---------------+------------+------------+---------------+-------------------+--------------+------------------------+----------------------------+
| Lev1          | t          |          1 |    0.00000000 | 10000000.00000000 |           20 |                 5.0000 |                     2.5000 |
| Heather Doyle | f          |          1 |    0.00000000 |    10000.00000000 |           50 |                 0.2000 |                     0.1000 |
+---------------+------------+------------+---------------+-------------------+--------------+------------------------+----------------------------+
(2 rows)
```

**Bands in plain English**

- **Lev1 (default):** Single tier — notional from **0** up to **10,000,000** (exclusive upper bound in `risk::effective_leverage`: `notional < notional_to`) at **20×**; IM/MM **5% / 2.5%**. The **top** tier has a **finite** `notional_to` of **10M**, not NULL — so notionals **≥ 10M** would fall out of the band unless another mechanism applied (there is no second tier).
- **Heather Doyle:** Single tier — **0 → 10,000** at **50×**; IM/MM **0.2% / 0.1%**. Top tier is **capped at $10k** — any estimate with notional **≥ 10,000** would fail `effective_leverage` for users actually assigned this profile.

**Profiles with no rows in Query C:** **Lev3**, **Test Profile** (no tiers).

---

## 5. Query D results — BTCUSDT

**Raw output:**

```
+--------------------------------------+---------+--------+---------------+----------------+-----------------+
|                  id                  |  code   | market | base_currency | quote_currency | trading_enabled |
+--------------------------------------+---------+--------+---------------+----------------+-----------------+
| 344b6f89-e22f-4fb4-928d-15652cddbb9c | BTCUSDT | crypto | BTC           | USDT           | t               |
+--------------------------------------+---------+--------+---------------+----------------+-----------------+
(1 row)
```

**Interpretation:** **BTCUSDT** exists, is **crypto**, **USDT** quote, **`trading_enabled = t`**.

---

## 6. DIAGNOSIS

### Which profile applies for BTCUSDT?

- **Users in group G1:** Explicit **Lev1** on `group_symbols`.
- **Users in Default / G4 / g3 / g5 / g6 (this DB):** No per-symbol or group-default profile in SQL; the auth service **falls back to the platform default** → **Lev1** (`is_default = true`).

So for typical dev users on the **Default** group, **Lev1** is the effective profile for BTCUSDT.

### Does the top tier have a finite cap?

- **Lev1:** Yes — **`notional_to = 10,000,000`** (USD-scale numeric as stored).
- That cap is **far above** an order notional of roughly **5.15 × 77,488 ≈ 399k**, so **this dev database does not show a tier “gap” that would reject ~$399k** under Lev1.

### Hypothetical slider % at cap (requested formula)

Using the rough UI mental model “slider % ≈ fraction of free margin allocated to margin at the **cap** leverage” (as in your prompt):  
**slider % ≈ `cap / (free_margin × leverage_at_cap)` × 100**, with `free_margin = 22,891.53` and `leverage_at_cap = 20` (Lev1 max tier):

| Hypothetical cap (USD) | Approx. slider % |
|------------------------|-------------------|
| 350,000 | **~76.4%** |
| 375,000 | **~81.9%** |
| 400,000 | **~87.4%** |

- A **~$400k** effective cap at **20×** would land very close to the observed **“fails above ~87%”** behavior.
- **This environment’s Lev1 cap is $10M**, so the **~87% correlation is *not* explained by the current local `newpt` tier data** for Lev1 users.

**Plausible reconciliations (UNCERTAIN without comparing the failing environment):**

1. The screenshot / failure came from **another database** (e.g. staging/prod) where the default profile’s top `notional_to` is **~350k–400k**, not 10M.
2. The failing user was on a **profile not visible in this BTCUSDT×group grid** (e.g. different symbol row, or data changed after the incident).
3. The **400** was not `LEVERAGE_CONFIGURATION` (e.g. plain `BAD_REQUEST` for price/malformed body) — worth confirming from the response JSON.

### Heather Doyle profile

- If any user/group were wired to **Heather Doyle** for BTCUSDT, **notional > 10,000** would fail immediately — that would break **almost all** slider percentages, not only “high %,” so it **does not match** the narrow “>~87%” symptom unless that profile is rarely used.

---

## 7. RECOMMENDED FIX (not executed)

### A. Make Lev1’s single tier open-ended (optional clarity / future-proofing)

Current top tier: `profile_id = f4353a28-929a-44fd-a9e4-152ed8281b57`, `tier_index = 1`.

```sql
UPDATE leverage_profile_tiers
SET notional_to = NULL
WHERE profile_id = 'f4353a28-929a-44fd-a9e4-152ed8281b57'
  AND tier_index = 1;
```

*Rationale:* Aligns with “last band open-ended” guidance in app error copy; **not required** to fix ~$400k notionals **on this DB** (10M already covers them).

### B. If you intend a lower max-notional band, add a new open-ended top tier instead

Example **shape** only (adjust `notional_from`, leverages, and UUIDs to taste):

```sql
-- Example only — do not run blindly.
-- INSERT INTO leverage_profile_tiers (
--   id, profile_id, tier_index, notional_from, notional_to,
--   max_leverage, initial_margin_percent, maintenance_margin_percent,
--   created_at, updated_at
-- ) VALUES (
--   gen_random_uuid(),
--   'f4353a28-929a-44fd-a9e4-152ed8281b57',
--   2,
--   10000000,
--   NULL,
--   10,
--   10.0000,
--   5.0000,
--   NOW(),
--   NOW()
-- );
```

*(Commented so it is not mistaken for a required migration; user would need valid column defaults and tier_index uniqueness per their schema.)*

### C. Heather Doyle — only if this profile is assigned anywhere

```sql
UPDATE leverage_profile_tiers
SET notional_to = NULL
WHERE profile_id = '16668daa-a273-41ce-9722-791d4c6866ed'
  AND tier_index = 1;
```

*Use only if business rules allow unlimited notional at 50× for that profile; otherwise raise `notional_to` or add higher bands.*

---

## Summary

| Question | Answer (this `newpt` @ localhost:5434) |
|----------|----------------------------------------|
| Connect how? | Host `psql` to **`127.0.0.1:5434`**, db **`newpt`**, user **`postgres`**. |
| Default profile | **Lev1** — one tier **0 ≤ notional < 10,000,000** @ **20×**. |
| Explains ~$399k @ ~87%? | **No** — cap is **10M**; notional ~399k is inside the band. |
| Any capped profile dangerous? | **Heather Doyle** caps at **$10k** — would break large estimates if selected. |

---

*Diagnostic completed with **SELECT-only** statements. No `INSERT`/`UPDATE`/DDL was executed.*
