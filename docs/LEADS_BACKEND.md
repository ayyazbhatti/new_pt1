# Leads Management Backend

Rust backend for the Leads UI: **core-api** (REST), **gateway-ws** (WebSocket), **email-worker** (NATS consumer).

## Prerequisites

- Postgres DB `newpt` (see infra migrations)
- NATS, Redis (e.g. `infra/docker-compose.yml`)

## Env

Copy `.env.example` and set at least:

- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/newpt`
- `NATS_URL=nats://127.0.0.1:4222`
- `REDIS_URL=redis://127.0.0.1:6379`
- `JWT_SECRET=` (min 32 chars)

Optional: `PORT=3004` (core-api), SMTP vars for email-worker.

## Run

1. **Migrations**  
   Apply `infra/migrations/` (e.g. `003_crm_schema.sql`) to the `newpt` database.

2. **core-api**  
   From repo root:
   ```bash
   cargo run -p core-api
   ```
   Listens on `PORT` (default 3004). Serves `/api/leads`, `/api/lead-stages`, `/api/email-templates`, etc. CRM outbox publisher runs in-process (publishes `crm.outbox_events` to NATS).

3. **gateway-ws**  
   WebSocket server; subscribes to NATS `leads.>` and broadcasts to authenticated sessions (filtered by team and agent role). Run: `cargo run -p gateway-ws` (default port 3003).

4. **email-worker**  
   Consumes NATS `leads.email.queued` (payload `{ "message_id": "uuid" }`), loads message from DB, sends via stub (or SMTP when configured), updates `crm.lead_messages`, inserts activity and outbox events (`leads.email.sent` / `leads.email.failed`). Run: `cargo run -p email-worker`.

## Docker

Start Postgres, NATS, Redis:

```bash
cd infra && docker-compose up -d
```

Run core-api (and optionally gateway-ws, email-worker) locally with the env above.
