# Infrastructure Layer — Security & Correctness Audit

**Scope:** `deploy/`, `infra/`, Dockerfiles, env templates, nginx, deployment docs, migration runner.  
**Mode:** Read-only. **Date:** 2026-05-19.

---

# 0. Executive Summary

Production topology is **mostly sound at the Docker Compose layer**: only the **frontend** service publishes a host port (`8080:80`); Postgres, Redis, NATS, auth, ws-gateway, data-provider, order-engine, and core-api stay on the default bridge network without host binding. TLS is terminated on a **host-level nginx** (`deploy/nginx-ssl-ptf.conf`) proxying to that frontend container, which in turn reverse-proxies `/api`, `/ws`, and **`/dp/`** (data-provider, including unauthenticated **`/prices`**).

Critical infrastructure failures are **secrets in version control**: production `POSTGRES_PASSWORD` and `JWT_SECRET` appear in **`docs/HETZNER_DEPLOYMENT.md`** and **`deploy/setup-new-server.sh`**, and dev `.env` files are **git-tracked**. There is **no automated encrypted backup**, **no CI/CD**, **no Redis/NATS authentication**, migrations run as **Postgres superuser** with a **non-idempotent `|| true` loop**, and **security headers / rate limits are absent** from nginx configs in-repo.

**Trust score: 4/10** (harmonic mean).

**Verdict: 🔴 No-go** until production secrets are rotated and removed from git, and baseline hardening (NATS/Redis auth, backup/restore, nginx headers) is in place.

**Top 3 issues**

1. **Critical — Production database password and JWT secret committed to the repository** (`docs/HETZNER_DEPLOYMENT.md`, `deploy/setup-new-server.sh`).
2. **Critical — Unauthenticated market data exposed on the public edge** via `https://<host>/dp/prices` (data-provider F2 at the network boundary).
3. **High — No Redis password, no NATS authentication**; any container compromise on the compose network can read/write trading state and publish arbitrary NATS messages (amplifies order-engine F9).

---

# 1. Module Inventory

| Path | Purpose |
|------|---------|
| `deploy/docker-compose.prod.yml` | Production stack: Postgres 15, Redis 7, NATS+JetStream, migrations job, auth, ws-gateway, data-provider, order-engine, core-api, frontend |
| `deploy/docker-compose.registry.yml` | Override to pull pre-built images from a registry |
| `deploy/Dockerfile.backend` | Multi-stage Rust build → Debian slim runtime (all backend binaries) |
| `deploy/Dockerfile.frontend` | Vite build → nginx:alpine static + `nginx-default.conf` |
| `deploy/nginx-default.conf` | In-container reverse proxy: `/api`, `/v1`, `/ws`, `/ws-health`, `/dp/` → internal services |
| `deploy/nginx-ssl-ptf.conf` | **Host** TLS vhost → `127.0.0.1:8080`; HTTP→HTTPS redirect |
| `deploy/.env.production.example` | Template for prod secrets (placeholders only) |
| `deploy/setup-and-deploy.sh` | First-boot: Docker install, random secrets if missing, compose up |
| `deploy/setup-new-server.sh` | Server migration script — **contains hardcoded prod secrets** |
| `deploy/build-and-push.sh` | Local build + push to Docker Hub/GHCR |
| `deploy/DEPLOY_STEPS.md` | Manual deploy notes (server IP, root access) |
| `deploy/remote-pull-restart.sh`, `rebuild-*.sh` | Operational helpers |
| `deploy/scripts/watch-feed-freshness.sh` | Cron-friendly feed health via `http://127.0.0.1:8080/dp/health/fresh` |
| `deploy/scripts/collect-system-stats.sh` | Host/container stats JSON for admin API |
| `infra/docker-compose.yml` | **Dev only**: Postgres 16, Redis, NATS — **host ports exposed** |
| `infra/migrations/*.sql` | SQL migrations (57+ files) applied by prod migration container |
| `.env.example` | Root dev env documentation |
| `backend/auth-service/.env.example` | Dev DB URL template |
| `backend/auth-service/.env`, `.env.backup`, `.env.bak` | **Tracked in git** (dev credentials) |
| `docs/HETZNER_DEPLOYMENT.md` | Deployment runbook — **contains live prod secrets** |
| `scripts/import-local-db-to-server.sh` | Manual pg_dump / pg_restore to server (referenced in docs) |

**No** `.github/workflows/`, `.gitlab-ci.yml`, or similar CI/CD configs found in the repo.

---

# 2. Architecture Overview

## 2.1 Production network topology (ASCII)

```
                    Internet
                        |
                   [ TLS :443 ]
                        |
            Host nginx (nginx-ssl-ptf.conf)
            ptf.interwarepvt.com
                        |
                 http://127.0.0.1:8080
                        |
    +-------------------+-------------------+
    |     Docker host (default bridge)      |
    |  +---------------------------------+  |
    |  | frontend:80  (ONLY published     |  |
    |  |              host 8080:80)       |  |
    |  |  nginx-default.conf:             |  |
    |  |    /        -> static SPA        |  |
    |  |    /api/*   -> auth:3000         |  |
    |  |    /v1/*    -> auth:3000         |  |
    |  |    /ws     -> ws-gateway:3003    |  |
    |  |    /ws-health -> ws-gw:9002      |  |
    |  |    /dp/*   -> data-provider:9004 |  |
    |  +---------------------------------+  |
    |         |    |      |       |         |
    |      auth  ws-gw  data-prov  order-eng |
    |       :3000 :3003  :9004    :3002     |
    |         \    |      |       /          |
    |          postgres redis  nats:4222     |
    |          :5432  :6379   (JetStream)   |
    |          core-api :3004 (internal)    |
    +---------------------------------------+
```

**Internet-facing:** host **80/443** (nginx) → container **8080** → frontend nginx.  
**Not host-published in prod compose:** Postgres, Redis, NATS, auth, ws-gateway, data-provider, order-engine, core-api.

## 2.2 `docker-compose.prod.yml` services

| Service | Image / build | Restart | depends_on | Host `ports` |
|---------|---------------|---------|------------|--------------|
| postgres | `postgres:15` | unless-stopped | — | **none** |
| redis | `redis:7-alpine` | unless-stopped | — | **none** |
| nats | `nats:latest` | unless-stopped | — | **none** |
| migrations | `postgres:15` (one-shot) | `no` | postgres healthy | **none** |
| auth | build `Dockerfile.backend` | unless-stopped | pg, redis, nats, migrations | **none** |
| ws-gateway | same image, `ws-gateway` cmd | unless-stopped | redis, nats | **none** |
| data-provider | same image | unless-stopped | pg, redis, nats | **none** |
| order-engine | same image | unless-stopped | redis, nats | **none** |
| core-api | same image | unless-stopped | pg, redis, nats | **none** |
| frontend | `Dockerfile.frontend` | unless-stopped | auth, ws-gateway, data-provider | **`8080:80`** |

- **Network mode:** implicit default bridge (no custom `networks:` block — single flat Docker network).
- **Volumes:** `postgres_data`, `redis_data` (named); auth mounts `./stats:/host-stats:ro`.
- **Logging:** `json-file`, 50m × 3 files per several services.

## 2.3 TLS termination

| Layer | TLS |
|-------|-----|
| Host `nginx-ssl-ptf.conf` | **Yes** — Let's Encrypt paths, HTTP→301 HTTPS |
| Frontend container `nginx-default.conf` | **No** — HTTP only on port 80 |
| Individual backends | **No** |

Certificate management is **manual/Let's Encrypt** (paths in config); no certbot automation in repo.

## 2.4 Example request trace (HTTPS API login)

1. Client `POST https://ptf.interwarepvt.com/api/auth/login`
2. Host nginx TLS termination → `proxy_pass http://127.0.0.1:8080`
3. Frontend container nginx `location /api/` → `http://auth:3000`
4. auth-service handles request; talks to `postgres:5432`, optional `redis`, `nats:4222`

---

# 3. Findings — DETAILED

## 3.1 Secrets management

| Mechanism | Finding |
|-----------|---------|
| Production delivery | `env_file: .env.production` on auth/ws-gateway/data-provider/migrations; inline `environment:` in compose |
| Docker secrets / Vault | **Not used** |
| `.env.production.example` | Placeholders only (`change-me-...`) — **OK** |
| `.gitignore` | Ignores `.env`, `*.env` with `!*.env.example` |

**INF-S01 (Critical) — Production secrets in git**

```15:16:docs/HETZNER_DEPLOYMENT.md
| **Postgres password (production)** | `<REDACTED — was committed; rotated>` |
| **JWT_SECRET (production)** | `<REDACTED — was committed; rotated>` |
```

```77:81:deploy/setup-new-server.sh
  cat > "$ENV_FILE" << 'ENVEOF'
POSTGRES_PASSWORD=<REDACTED>
JWT_SECRET=<REDACTED>
JWT_ISSUER=newpt
CORS_ORIGINS=http://178.104.63.176
```

**Action:** Rotate Postgres + JWT immediately; purge from git history; use secret manager or server-only files never committed.

**INF-S02 (High) — Tracked dev `.env` files**

`git ls-files` includes `backend/auth-service/.env`, `.env.backup`, `.env.bak` (dev `postgres:postgres` URLs). Violates `.gitignore` intent (committed before ignore). Risk if developers ever place real keys there.

**INF-S03 (High) — Auth F4 still reachable if `JWT_SECRET` empty**

Compose sets `JWT_SECRET: ${JWT_SECRET}`. If `.env.production` is missing or empty, auth-service falls back:

```36:44:backend/auth-service/src/utils/jwt.rs
pub fn get_jwt_secret() -> String {
    const DEV_FALLBACK: &str = "dev-jwt-secret-key-change-in-production-minimum-32-characters-long";
    match env::var("JWT_SECRET") {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            warn!("JWT_SECRET not set; using dev fallback. Set JWT_SECRET in production.");
            DEV_FALLBACK.to_string()
```

ws-gateway **fails fast** (`expect("JWT_SECRET must be set")`) — good — but auth could still issue tokens with known dev secret.

**API keys at runtime:** Anthropic, MMDPS, Voiso — `deploy/.env.production.example` + DB (`platform_ai_config`, `platform_voiso_config`); passed as env to containers. **Encryption at rest:** not configured for Postgres volumes or backups in repo.

---

## 3.2 Network exposure

| Service | Expected | Actual (prod compose) |
|---------|----------|------------------------|
| auth | Internal; public via proxy only | **Internal** ✓ |
| ws-gateway | Internal; `/ws` via proxy | **Internal** ✓ |
| data-provider HTTP :9004 | Internal preferred; `/prices` unauthenticated | **Internal port**, but **public via `/dp/`** on edge |
| order-engine | NATS/Redis only | **Internal** ✓ |
| core-api | Internal / optional | **Internal** ✓ |
| postgres | Internal only | **Internal** ✓ |
| redis | Internal only | **Internal** ✓ |
| nats | Internal only | **Internal** ✓ |
| frontend/nginx | Public | **8080:80** + host TLS |

**INF-N01 (Critical) — Public `/dp/prices`**

```105:117:deploy/nginx-default.conf
    location /dp/ {
        rewrite ^/dp/?(.*)$ /$1 break;
        proxy_pass $dp_upstream;
```

Maps to data-provider routes including **`GET /prices`** (no auth — data-provider audit F2). Any Internet client can scrape prices from production domain.

**INF-N02 (Medium) — Dev `infra/docker-compose.yml` exposes data plane on host**

Ports `5434`, `6379`, `4222`, `8222` published — acceptable for **dev only**; must not run on production host alongside prod stack without firewall.

**INF-N03 (Low) — `/ws-health` and `/dp/health` public**

Reachable through frontend nginx without authentication — operational intelligence (feed freshness, etc.).

---

## 3.3 TLS/HTTPS

**Strengths:** `nginx-ssl-ptf.conf` enforces HTTPS redirect for `ptf.interwarepvt.com`.

**Gaps (INF-TLS01, Medium):**

- No `ssl_protocols` / cipher suite hardening in repo
- **No HSTS** (`Strict-Transport-Security`)
- No OCSP stapling configuration documented
- TLS version not pinned to 1.2+ in config files

Subdomain vs path: API and WS share host with SPA (path-based `/api`, `/ws`), not separate API subdomain.

---

## 3.4 nginx / reverse proxy

| Control | Present? |
|---------|----------|
| Path routing to auth / ws / data-provider | Yes |
| WebSocket Upgrade/Connection maps | Yes (container + host ssl config) |
| `client_max_body_size` | **Not set** (default 1m) — may block large KYC uploads |
| Rate limiting (`limit_req`) | **No** |
| Security headers (XFO, XCTO, CSP, Referrer-Policy) | **No** in `nginx-default.conf` or `nginx-ssl-ptf.conf` |
| CORS at nginx | **Reflects any `http(s)://` Origin** on `/api` and `/v1` |

```1:5:deploy/nginx-default.conf
map $http_origin $cors_origin {
    "~^https?://" $http_origin;
    default "";
}
```

This is **broader** than auth-service CORS (which checks `CORS_ORIGINS` list). Nginx adds permissive CORS headers on proxied API responses.

---

## 3.5 Database hardening

| Item | Status |
|------|--------|
| Version | Postgres **15** (prod), **16** (dev infra) |
| App connections | `postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/newpt` — **superuser** |
| SSL to Postgres | **Not configured** in `DATABASE_URL` |
| pg_hba | Not in repo (container default trust within Docker network) |
| Backups | **Manual** `scripts/import-local-db-to-server.sh` / docs only; **no scheduled pg_dump** in deploy |
| Migrations | One-shot container runs **all** `*.sql` with failures ignored |

**INF-DB01 (High) — Migration runner non-idempotent and ignores errors**

```51:54:deploy/docker-compose.prod.yml
        for f in /migrations/*.sql; do
          [ -f "$$f" ] && echo "Applying $$f" && psql -h postgres -U postgres -d newpt -f "$$f" || true
        done
```

`|| true` hides failed migrations; re-running on fresh DB vs existing DB behaves differently; no versioning table in this shell loop.

**INF-DB02 (High) — No documented encrypted backup / restore test**

Losing `postgres_data` volume = total platform data loss. Docs describe one-off import, not retention or PITR.

---

## 3.6 Redis hardening

```21:24:deploy/docker-compose.prod.yml
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
```

| Item | Status |
|------|--------|
| `requirepass` | **No** |
| Bind | Container network only (prod) |
| Persistence | **AOF enabled** — positions, account summaries, rate limits survive restart |
| ACLs | **No** |

**INF-R01 (High)** — Compromised container on bridge can `redis-cli -h redis` read/write all keys including open positions.

---

## 3.7 NATS hardening

```33:36:deploy/docker-compose.prod.yml
  nats:
    image: nats:latest
    command: ["-js", "-m", "8222"]
```

| Item | Status |
|------|--------|
| Authentication | **None** |
| JetStream | **Enabled** (`-js`) |
| Monitoring | Port 8222 inside container (not host-published in prod) |
| Image tag | **`nats:latest`** unpinned |

**INF-NATS01 (High)** — Confirms order-engine assumption (“only our publishers”) is **policy-only**, not enforced. Any bridge-network client can publish `cmd.order.place` subjects.

---

## 3.8 Container security

**`deploy/Dockerfile.backend`:**

| Check | Result |
|-------|--------|
| Multi-stage | **Yes** (builder → debian:bookworm-slim) |
| Base image pin | **Tag only** (`rust:1-bookworm`, `debian:bookworm-slim`) — no digest |
| USER | **Not set — runs as root** |
| Healthcheck | Only ws-gateway in compose |
| curl in image | Yes (used for ws-gateway healthcheck) |

**`deploy/Dockerfile.frontend`:** node builder → `nginx:alpine` — non-root nginx worker by default in alpine image.

**INF-C01 (Medium)** — All Rust services run as root in container; `COPY . .` build context relies on `.dockerignore` excluding `.env` (does not remove committed secrets from git risk).

---

## 3.9 Volume and persistent storage

| Volume | Data | Risk |
|--------|------|------|
| `postgres_data` | All platform DB | No off-site backup in repo |
| `redis_data` | AOF — trading state | Loss = position/account inconsistency |
| KYC uploads | `KYC_UPLOAD_DIR` default `./uploads/kyc` inside auth container | **No bind mount in prod compose** — uploads **lost on container recreate** unless volume added |

**INF-V01 (Medium)** — KYC files not on persistent volume in production compose.

`setup-new-server.sh` moves Docker root to `/mnt/data500/docker` — good for disk capacity; permissions depend on host setup.

---

## 3.10 Logging infrastructure

| Item | Config |
|------|--------|
| Collection | Docker `json-file` driver, 50m × 3 rotation |
| Central aggregator | **Not defined** in repo |
| Access control | **Not documented** — typically root + Docker group on host |

**Amplification of application findings:**

- **Auth F2:** OTP logged at INFO → anyone with `docker logs` or log file access sees OTPs.
- **ws-gateway / frontend F11:** JWT prefixes in browser/server logs.

If logs are shipped to a shared SIEM without RBAC, severity → **Critical**.

---

## 3.11 Monitoring and alerting

| Service | Healthcheck |
|---------|-------------|
| postgres, redis | `pg_isready` / `redis-cli ping` |
| ws-gateway | `curl` to `:9002/health` |
| auth, data-provider, order-engine, core-api | **None in compose** |

**Public/metrics:**

- ws-gateway `/metrics` on :9002 — proxied as `/ws-health` only for health path; metrics route not exposed in nginx snippet (still reachable internally).
- data-provider `/metrics`, `/feed/status` — internal; `/dp/` exposes health/fresh publicly.

**Alerting:** `watch-feed-freshness.sh` exists; no Prometheus/Grafana in repo.

---

## 3.12 CI/CD pipeline

**Not present** in repository (no GitHub Actions, GitLab CI, etc.).

Deploy model:

- Manual `setup-and-deploy.sh` / SSH + `docker compose build`
- Optional `build-and-push.sh` + `docker-compose.registry.yml`

**INF-CI01 (Medium):** No automated tests, signing, or approval gates; registry images tagged `:latest` only.

---

## 3.13 Backup and disaster recovery

| Asset | Backup in repo? |
|-------|-----------------|
| Postgres | Manual import script only |
| Redis | Rely on AOF volume — **no backup** |
| NATS JetStream | **No** persistence config beyond `-js` defaults |
| Restore tested | Documented ad hoc, **no schedule** |

**INF-DR01 (High)** — Redis holds open positions (order-engine); losing `redis_data` is a **trading outage** with no documented restore.

---

## 3.14 Development vs production parity

| Aspect | Dev | Prod |
|--------|-----|------|
| Postgres | 16-alpine, port 5434 | 15, internal |
| Secrets | `postgres/postgres`, tracked `.env` | Should be strong random — **but leaked in docs** |
| Published ports | Many on host | Only 8080 |
| JWT | Same dev fallback risk if unset | Must set `JWT_SECRET` — **known value in git** |

**INF-P01 (Critical)** — Documented production JWT/DB password must be assumed **compromised**.

---

## 3.15 Egress control

No firewall/network policy in repo. Containers need outbound: Anthropic, Binance, MMDPS, SMTP, Voiso — **wide open egress** assumed.

---

## 3.16 Public attack surface

| Port / path | TLS | Auth | Rate limit |
|-------------|-----|------|------------|
| 443 `/` SPA | Yes (host) | Public | No |
| 443 `/api/*` | Yes | Per-route JWT/session | App-level only |
| 443 `/ws` | Yes | JWT at WS handshake | No |
| 443 `/dp/prices` | Yes | **None** | No |
| 443 `/dp/health`, `/ws-health` | Yes | **None** | No |
| 8080 (if exposed without host nginx) | Maybe not | Same | No |

**No accidental exposure** of Postgres/Redis/NATS ports on prod compose — **confirmed**.

---

## 3.17 Health endpoints

| Endpoint | Via public edge? | Information disclosed |
|----------|------------------|------------------------|
| auth `/health` | Only if routed (not in frontend nginx — **internal**) | Returns `"OK"` string |
| ws-gateway `/health` | `/ws-health` proxy | Connection/subscription counts (JSON) |
| data-provider `/health`, `/health/fresh` | `/dp/health`, `/dp/health/fresh` | Region, uptime, feed ages, thresholds |
| data-provider `/metrics`, `/feed/status` | Not proxied by default | Room/symbol counts |

**INF-H01 (Low)** — Feed health on public edge aids reconnaissance; not secret but useful to attackers.

---

## 3.18 Supply chain

| Source | Notes |
|--------|-------|
| npm (frontend) | Frontend audit: 15 vulns (mostly toolchain) |
| Rust/Cargo.lock | Not exhaustively audited here; use `cargo audit` in CI |
| Docker images | `postgres:15`, `redis:7-alpine`, `nats:latest` — **floating tags** |
| Third-party APIs | Anthropic, Binance, MMDPS, Voiso — credentials in env/DB |

`.dockerignore` excludes `target/`, `node_modules`, `.env` — reduces accidental secret bake on **build machine** if file is local-only.

---

## 3.19 Secrets in git history

**Current tree contains live production credentials** (see INF-S01). Even after deletion, history may retain them — requires `git filter-repo` or BFG and rotation.

`DEPLOY_STEPS.md` references server IP and root password workflow (operational exposure).

---

## 3.20 Time and NTP

Not configured in repo. JWT validation across auth + ws-gateway requires reasonable host clock sync (standard NTP on Ubuntu assumed, not verified).

---

# 4. Strengths

1. **Single published port** in production compose — backend services not bound to host.
2. **Multi-stage backend Dockerfile** — smaller runtime image, no Rust toolchain in prod.
3. **Frontend container acts as API gateway** — consistent path routing to internal DNS names.
4. **Host-level TLS** with HTTP→HTTPS redirect for production domain.
5. **Healthchecks** on Postgres, Redis, ws-gateway; migration job gated before auth starts.
6. **`setup-and-deploy.sh` generates random secrets** when `.env.production` is absent (good pattern undermined by committed secrets elsewhere).
7. **Log rotation** via Docker json-file limits on key services.
8. **`.env.production.example`** uses clear placeholders, not real secrets.
9. **ws-gateway refuses empty `JWT_SECRET`** at startup (panic) — fails closed vs auth’s dev fallback.
10. **Auth CORS** in application layer is stricter than nginx’s reflect-any-origin map (defense if nginx headers stripped).

---

# 5. Trust Score Breakdown

| Category | Score |
|----------|------:|
| Secret management | 2/10 |
| Network exposure / segmentation | 6/10 |
| TLS configuration | 5/10 |
| Database hardening | 4/10 |
| Container security | 5/10 |
| Logging infrastructure safety | 4/10 |
| Backup / disaster recovery | 3/10 |
| CI/CD security | 2/10 |
| Supply chain hygiene | 5/10 |
| Public attack surface minimization | 5/10 |

**Harmonic mean ≈ 4.0/10 → reported 4/10**

---

# 6. Production Go-Live Verdict

## 🔴 No-go

Rotate all secrets that appeared in git; remove from docs/scripts; add Redis/NATS auth and backups before production traffic.

---

# 7. Prioritized Fix List

| # | Finding | Sev | Effort | Sprint |
|---|---------|-----|--------|--------|
| 1 | INF-S01: Remove prod secrets from git; rotate JWT + Postgres; scrub history | Critical | M | **Immediate** |
| 2 | INF-S02: Untrack `.env*`; git filter-repo if ever held real keys | Critical | S | **Immediate** |
| 3 | INF-N01: Block or auth `/dp/prices` at edge; or keep data-provider off public paths | Critical | M | 1 |
| 4 | INF-NATS01 + INF-R01: Enable NATS auth + Redis `requirepass` | High | M | 1 |
| 5 | INF-DB01: Replace migration shell with versioned runner (fail on error) | High | M | 1 |
| 6 | INF-DB02 + INF-DR01: Scheduled encrypted pg_dump + Redis backup; test restore | High | L | 1–2 |
| 7 | INF-S03: Auth refuse to start if `JWT_SECRET` missing/weak (match ws-gateway) | High | S | 1 |
| 8 | INF-TLS01 + INF-CSP01: HSTS, security headers, TLS hardening on host nginx | Medium | S | 1 |
| 9 | INF-V01: Persistent volume for `KYC_UPLOAD_DIR` | Medium | S | 2 |
| 10 | INF-CI01: Add CI with `cargo audit`, `npm audit`, image digest pins | Medium | L | 2 |
| 11 | Pin images (`nats:2.10.x`, digests); non-root USER in backend image | Medium | M | 2 |
| 12 | nginx rate limits + tighten CORS map to known origins | Medium | M | 2 |

---

# 8. Cross-Module Notes

| Prior audit | Infrastructure interaction |
|-------------|---------------------------|
| **Auth F4** | Mitigated in prod when `JWT_SECRET` set — **undermined** by committed secret + dev fallback if env empty |
| **Auth F2 (OTP logs)** | Severity **Critical** if operators use `docker logs` without access controls |
| **ws-gateway F6, F11** | WS reachable only via `/ws` proxy; token logging on client + app — logs on host amplify |
| **Data-provider F2** | **`/dp/prices` is Internet-reachable** in standard deploy — confirm WAF or remove proxy |
| **Finance / Order engine** | Flat Docker network + no NATS/Redis auth = lateral movement after any RCE |
| **Frontend audit** | Impersonation tokens in URL + nginx missing headers — fix at host + app layers |
| **AI audit** | Anthropic key in `.env.production` / DB — protect server file permissions (`chmod 600`) |

---

*End of audit.*
