# Scalability & Reliability for 10M+ Users

This document outlines a professional, production-grade path to support **10M+ users** with high availability, low latency, and cost-effective scaling.

---

## 1. Executive Summary

| Area | Current risk | Target |
|------|--------------|--------|
| **Redis** | One connection per position/price lookup → socket exhaustion (EADDRNOTAVAIL), 500s | Connection pooling, single-connection-per-request for reads, pipeline/batch where needed |
| **PostgreSQL** | Single pool, no read scaling | PgBouncer + read replicas, partitioning for orders/positions |
| **NATS** | Basic pub/sub, single order-engine | JetStream + consumer groups, multiple order-engine instances |
| **API (auth-service)** | Stateless but Redis/DB failures surface as 500 | Circuit breakers, graceful degradation, rate limiting, horizontal scaling |
| **Observability** | Logs only | Metrics (latency, error rate, throughput), distributed tracing, alerting |

---

## 2. Redis

### 2.1 Connection usage (root cause of current 500s)

- **Problem**: Handlers that open **one Redis connection per item** (e.g. per position, per price lookup) cause connection spikes and OS errors (`Can't assign requested address`, EADDRNOTAVAIL).
- **Fix (implemented)**:
  - **get_user_positions**: Use **one connection** for the entire request: `SMEMBERS` then sequential `HGETALL` per position, then reuse the same connection for all price lookups when enriching unrealized PnL. No N parallel connections.
  - **place_order**: Already uses one connection for idempotency + free_margin; ensure no extra connections in the hot path.

### 2.2 Connection pooling (next step)

- Use **redis with `connection-manager`** (you already have the feature) and a **connection pool** (e.g. `deadpool` or a small pool of `ConnectionManager` instances) so each service has a bounded number of connections (e.g. 50–200 per instance) instead of unbounded `get_async_connection()` per operation.
- **Configuration**: Max connections per auth-service instance (e.g. 100), timeout, and retry with backoff.

### 2.3 Key design and scaling

- **Key layout**: Already good (e.g. `pos:{user_id}`, `pos:by_id:{id}`, `prices:{symbol}:{group_id}`). For 10M users, keep keys **shardable by user_id** so you can move to **Redis Cluster** later without rehashing.
- **Pipelining**: For endpoints that need many reads (e.g. list positions), use a **single connection + pipeline** (multiple `HGETALL` in one round-trip) to reduce latency and connection count.
- **Caching**: Short TTL cache (e.g. 1–5 s) for “list positions” or “account summary” per user can reduce Redis and DB load under spike traffic; invalidate on order/position events (NATS/Redis pub/sub).

### 2.4 Redis Cluster and HA

- **Single-instance**: Acceptable for early scale; use persistence (AOF + RDB) and replicas for failover.
- **10M+**: Move to **Redis Cluster** (sharding by key hash). Ensure key names are designed so hot keys (e.g. one user’s data) don’t all land on one node; avoid global keys or split them (e.g. per-shard).

---

## 3. PostgreSQL

### 3.1 Connection pooling

- **PgBouncer** (or similar) in front of Postgres: thousands of app connections → small, fixed pool of DB connections (e.g. 100–500). Prevents “too many connections” and improves stability under load.
- **Application**: Point `DATABASE_URL` at PgBouncer (transaction or session pooling); keep sqlx pool size per service instance moderate (e.g. 20–50).

### 3.2 Read replicas

- **Writes**: Primary (orders insert, position updates, user updates).
- **Reads**: Replicas for list orders, list positions (if stored in DB), reporting, admin dashboards. Use **read-only** `DATABASE_URL` for read path where consistency can be eventual (e.g. 100–500 ms delay acceptable).
- **Auth-service**: Use primary for place_order (insert order), idempotency, and margin checks; use replica for heavy read-only endpoints if you add DB-backed lists.

### 3.3 Partitioning and indexes

- **orders**: Partition by `created_at` (e.g. monthly) or by `user_id` hash for very large tables; index on `(user_id, status)`, `(user_id, created_at)`.
- **positions**: If persisted in DB, partition by `user_id` or time; index for active positions by user.
- **Monitoring**: Slow-query log, index usage; avoid full table scans on hot paths.

---

## 4. NATS and order-engine

### 4.1 JetStream

- **Durable streams**: `cmd.order.place` (and related) in JetStream so messages are stored and acked; no loss on consumer restart.
- **Consumer groups**: Multiple **order-engine** instances in a **push-based consumer group** so each message is processed by one instance; scale horizontally for order throughput.

### 4.2 Order placement API

- **Sync response**: Keep current “accept order → insert DB → publish NATS → return 200” for simplicity; ensure NATS publish has retry and timeout so transient NATS issues don’t always become 500 (e.g. return 503 with Retry-After or a clear error).
- **Optional async**: For extreme throughput, “202 Accepted” with `order_id` and process in background; frontend polls or uses WebSocket for status. Not required for 10M users if sync path is fast and resilient.

---

## 5. Auth-service (API tier)

### 5.1 Stateless horizontal scaling

- No local session state; JWT in Authorization header. Run **N instances** behind a load balancer (e.g. Kubernetes Deployment with 5–50 replicas depending on traffic).
- **Health checks**: `/health` must succeed when DB, Redis, and (if required) NATS are reachable; failing health stops traffic to that pod.

### 5.2 Resilience

- **Circuit breaker**: For Redis (and optionally DB/NATS), stop calling the dependency for a short period after repeated failures; return 503 and log. Prevents cascade and gives Redis/DB time to recover.
- **Timeouts and retries**: Bounded timeouts on Redis/DB/NATS calls; limited retries with backoff for idempotent operations.
- **Graceful degradation**: If “list positions” Redis fails, return 503 (or cached stub) instead of 500; if order placement NATS fails after DB insert, log and optionally queue for retry so order is not lost.

### 5.3 Rate limiting

- **Per-user**: Limit order placement and heavy endpoints per user (e.g. token bucket or sliding window) to protect backend and prevent abuse.
- **Global**: Limit per IP or per API key for unauthenticated or admin endpoints.
- Implement at API gateway (Kong, AWS ALB, etc.) or in auth-service middleware.

---

## 6. Observability

- **Metrics**: Latency (p50, p95, p99) and error rate per endpoint; Redis/DB connection and command metrics; NATS publish/deliver metrics. Export to Prometheus or equivalent.
- **Tracing**: OpenTelemetry (or similar) with trace IDs from gateway through auth-service and order-engine to correlate 500s with specific Redis/DB/NATS calls.
- **Structured logging**: Keep `place_order FAILED stage=...` and similar; add request_id and user_id to logs for debugging.
- **Alerting**: Alert on error rate > X%, latency > Y, or dependency (Redis/DB/NATS) down.

---

## 7. Deployment and operations

- **Containers**: Run auth-service, order-engine, and other services in containers (Docker); orchestrate with **Kubernetes** (or equivalent) for scaling, rolling updates, and health-based restart.
- **Secrets**: DB, Redis, NATS credentials from a secret store (e.g. Kubernetes Secrets, Vault); never commit credentials.
- **Config**: Environment-based config (already in place); consider feature flags for gradual rollout of pooling and circuit breakers.

---

## 8. Implementation phases

| Phase | Focus | Delivers |
|-------|--------|----------|
| **1 – Critical path** | Fix Redis connection usage in hot paths | Single connection per request in get_user_positions and price enrichment; no N connections per request |
| **2 – Pooling and resilience** | Redis/DB connection limits, circuit breakers, timeouts | Bounded connections, 503 instead of 500 on dependency failure, fewer cascading failures |
| **3 – Scale-out** | Read replicas, PgBouncer, JetStream consumer groups, multiple order-engine | Higher read capacity, durable messaging, horizontal order processing |
| **4 – 10M+** | Redis Cluster, partitioning, rate limiting, full observability | Sharded Redis, partitioned DB, protected and observable production |

The code change in this repo implements **Phase 1** (single-connection get_user_positions + price enrichment). Phases 2–4 can be implemented incrementally as traffic and user count grow.
