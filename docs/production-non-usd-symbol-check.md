# Production non–USD-quoted symbol usage — read-only check

**Purpose:** Re-run the same diagnostic as `docs/non-usd-symbol-usage-check.md` (dev: `newpt` @ `127.0.0.1:5434`) against **production**, to verify open non–USD/USDT positions and order activity before changing equity / FX code.

**Rules:** Read-only `SELECT` only. No connection was made to production from this workspace because **no production credentials were available** (see Step 1).

---

## 1. Connection method

| Item | Status |
|------|--------|
| **Established?** | **No** — queries were **not** executed against production. |
| **Bastion / SSH tunnel** | **Not attempted** (per instructions: do not set up tunnels from here). |
| **Docker exec on remote server** | **Not attempted** (would require SSH or equivalent access not present in repo). |

**How to connect when credentials exist (for operators):**

- **On the production host** (where `deploy/docker-compose.prod.yml` runs), Postgres listens as service **`postgres`** on port **5432** inside the Docker network (`DATABASE_URL` pattern: `postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/newpt` — see `deploy/docker-compose.prod.yml` auth service env).
- From the host, if the Postgres port is published, use `psql` with the real `POSTGRES_PASSWORD` from `deploy/.env.production`.
- Alternatively: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec postgres psql -U postgres -d newpt -c '...'`

---

## 2. Step 1 — Production credential discovery

### 2.1 `deploy/.env.production` (real file, gitignored)

**Result:** **File not present** in this workspace clone (`Read` / path check → not found). Typical reasons: never copied from example, or gitignored and not checked in (expected).

### 2.2 `deploy/.env.production.example` (template)

**Result:** **Present.** Contains **placeholders only**, e.g. `POSTGRES_PASSWORD=change-me-strong-password`, `JWT_SECRET=change-me-minimum-32-characters-long-secret`. **Not usable** as production credentials.

### 2.3 `deploy/docker-compose.prod.yml`

**Result:** Postgres service uses:

- `POSTGRES_USER: postgres`
- `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}` (default `postgres` only if unset at **runtime** on the server)
- `POSTGRES_DB: newpt`

Auth service: `DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@postgres:5432/newpt` — hostname **`postgres`** is **internal to the compose network**, not a host you can reach from a random developer laptop without tunnel or published port.

### 2.4 `infra/scripts/`

**Result:** No script in this pass stored a production `DATABASE_URL`. Example reference: `infra/scripts/backfill_user_events.sql` documents `psql "$DATABASE_URL"` — variable must be supplied by the operator.

### 2.5 Project root `.env*`

**Result:** Only `.env.example` (and service-specific `.env.example` files). **No** root `.env` with production DB URL in the repo.

### Conclusion (Step 1)

**No real production database credentials are available in this repository.** Proceeding would require either:

1. Adding / using **`deploy/.env.production`** on a machine that can reach production Postgres (with real `POSTGRES_PASSWORD`), or  
2. Running the same SQL **on the server** via `docker exec` / `psql` as documented above, or  
3. A **`DATABASE_URL`** (or host/port/user/password) supplied **out of band** by the operator (not committed here).

**Stopped here** — no guessing of hosts, passwords, or tunnels.

---

## 3. Step 2 — Query results (production)

**All sections below: NOT RUN — N/A until production `psql` succeeds.**

### Query 1 — Symbols by `quote_currency` (counts only; no `STRING_AGG`)

```text
(N/A — not executed)
```

### Query 2 — Orders on non–USD/USDT-quoted symbols

```text
(N/A — not executed)
```

### Query 3 — Open positions on non–USD/USDT-quoted symbols (**critical**)

```text
(N/A — not executed)
```

### Query 4 — Per-user breakdown (limit 50)

```text
(N/A — not executed)
```

### Query 5 — Sanity counts

```text
(N/A — not executed)
```

---

## 4. Step 3 — Side-by-side vs dev (`docs/non-usd-symbol-usage-check.md`)

| Metric | Dev (`127.0.0.1:5434` / `newpt`) — documented | Production — this run |
|--------|-----------------------------------------------|-------------------------|
| Query 1: distinct `quote_currency` row count | **35** rows (includes USD, USDT, and 33 others) | **—** |
| Query 2: non-USD/USDT order rows | **5** quote-currency groups, **30** orders total | **—** |
| Query 3: open non-USD/USDT position rows | **0** | **—** |
| Query 4: per-user rows returned | **10** | **—** |
| Query 5: `total_symbols` | **586** | **—** |
| Query 5: `enabled_symbols` | **586** | **—** |
| Query 5: `total_orders` | **179** | **—** |
| Query 5: `total_positions` | **0** | **—** |
| Query 5: `open_positions` (all symbols) | **0** | **—** |

**Catalog note:** Production **may** differ from dev (symbol seeds, toggles). Only a live Query 1 on production can confirm whether the `quote_currency` **distribution** matches.

---

## 5. Step 4 — Go / no-go (explicit)

**Cannot be decided from this document** because production was not queried.

Once production Query 3 and Query 5 are available, apply the same rubric as the dev report:

| Production Query 3 | Recommendation |
|--------------------|----------------|
| **0 rows** | **Path A safe** regarding *open* non-USD exposure — dimensional bug is latent until someone opens such a position. Still run Query 2 for historical activity. |
| **Small N rows** | List users/symbols; notify / allow close; then proceed. |
| **Large N rows** | **Replan** — migration / FX normalization before rollout. |

---

## 6. SQL to run (copy-paste) — production

Use after `psql` is connected to **production** `newpt`:

```sql
-- Query 1
SELECT
  quote_currency,
  COUNT(*) AS symbol_count,
  COUNT(*) FILTER (WHERE trading_enabled = true) AS enabled_count
FROM symbols
GROUP BY quote_currency
ORDER BY quote_currency;

-- Query 2
SELECT
  s.quote_currency,
  COUNT(DISTINCT o.id) AS total_orders,
  COUNT(DISTINCT o.user_id) AS distinct_users,
  COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'filled') AS filled_orders,
  COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'pending') AS pending_orders,
  MIN(o.created_at) AS first_order,
  MAX(o.created_at) AS most_recent_order
FROM orders o
JOIN symbols s ON s.id = o.symbol_id
WHERE s.quote_currency NOT IN ('USD', 'USDT')
GROUP BY s.quote_currency
ORDER BY total_orders DESC;

-- Query 3
SELECT
  s.quote_currency,
  s.code AS symbol,
  COUNT(*) AS open_positions,
  COUNT(DISTINCT p.user_id) AS distinct_users,
  SUM(p.size) AS total_size
FROM positions p
JOIN symbols s ON s.id = p.symbol_id
WHERE p.status = 'open'
  AND s.quote_currency NOT IN ('USD', 'USDT')
GROUP BY s.quote_currency, s.code
ORDER BY open_positions DESC;

-- Query 4
SELECT
  u.email,
  u.id AS user_id,
  s.quote_currency,
  COUNT(DISTINCT o.id) AS orders_placed,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'open') AS open_positions_now,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'closed') AS closed_positions
FROM users u
JOIN orders o ON o.user_id = u.id
JOIN symbols s ON s.id = o.symbol_id
LEFT JOIN positions p ON p.user_id = u.id AND p.symbol_id = s.id
WHERE s.quote_currency NOT IN ('USD', 'USDT')
GROUP BY u.email, u.id, s.quote_currency
ORDER BY orders_placed DESC
LIMIT 50;

-- Query 5
SELECT
  (SELECT COUNT(*) FROM symbols)                       AS total_symbols,
  (SELECT COUNT(*) FROM symbols WHERE trading_enabled) AS enabled_symbols,
  (SELECT COUNT(*) FROM orders)                        AS total_orders,
  (SELECT COUNT(*) FROM positions)                     AS total_positions,
  (SELECT COUNT(*) FROM positions WHERE status='open') AS open_positions;
```

Paste raw results back into **this file** (or a follow-up revision) under §3 and update §§4–5.

---

*Report generated without production DB access — credential discovery only.*
