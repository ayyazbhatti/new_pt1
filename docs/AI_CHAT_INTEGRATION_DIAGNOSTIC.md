# NEWPT — AI Chat Integration Diagnostic

> Prepared for designing a real-time AI chat feature. All paths, names, and snippets are from this repository as of the scan date.

---

## A. Existing Support Chat (frontend)

### 1. File tree (support-related)

**`src/features/support/`** (admin `/admin/support`)

```
src/features/support/
├── api/supportChat.api.ts
├── components/index.ts          # empty export placeholder
├── index.ts
├── mocks/index.ts
├── modals/index.ts
├── pages/SupportPage.tsx        # Admin support inbox
└── types/index.ts               # empty ("// Support types")
```

**`src/features/userPanel/`** (user `/user/support`)

```
src/features/userPanel/pages/UserSupportPage.tsx
```

**`src/features/terminal/`** (in-terminal chat panel — same patterns as user support)

```
src/features/terminal/
├── api/chat.api.ts
└── components/ChatPanel.tsx
```

**`src/shared/`** (WS + types)

```
src/shared/ws/wsClient.ts
src/shared/ws/wsEvents.ts          # includes chat.message inbound type
```

**Backend (reference for API/WS)**

```
backend/auth-service/src/routes/chat.rs
infra/migrations/007_support_messages.sql
```

### 2. User support chat — `UserSupportPage`

**Route:** `/user/support` → `UserSupportPage` in `src/app/router/userRoutes.tsx`.

**Component hierarchy**

```
UserSupportPage
└── ContentShell (flex flex-col flex-1 min-h-0 p-0 max-w-none w-full)
    ├── div (px-6 pt-6)
    │   ├── PageHeader (title="Support", description=...)
    │   └── Live badge (wsState === 'authenticated' → emerald; else amber)
    └── Card (flex flex-col flex-1 min-h-0 overflow-hidden)
        ├── scrollRef div (flex-1 min-h-0 overflow-auto p-4 space-y-3)  ← message list
        └── div (shrink-0 p-4 border-t border-border bg-surface/50)     ← input row
            ├── Input (shared/ui/input)
            └── button (Send icon, bg-accent/20)
```

**Message rendering** — no shared `<ChatBubble>`; inline `div`s:

- Row: `flex flex-col max-w-[85%]` + `items-end ml-auto` (user) or `items-start` (support)
- Bubble: `rounded-lg px-3 py-2 text-xs`
  - User: `bg-accent/20 text-text border border-accent/30`
  - Support: `bg-surface-2 text-text/90 border border-border`
- Meta line: `font-medium text-[10px] uppercase tracking-wider text-text-muted mt-1.5 text-right`

**Input**

- `Input` from `@/shared/ui/input` (`src/shared/ui/input/Input.tsx`)
- `handleSend`: `sendChatMessage(trimmed)` from `@/features/terminal/api/chat.api`
- `handleKeyDown`: Enter without Shift → `preventDefault` + `handleSend`
- No Shift+Enter multiline (single-line `Input`, not `textarea`)

**WebSocket**

- `wsClient` from `@/shared/ws/wsClient.ts`
- On mount: `wsClient.connect()` if `disconnected`
- Subscription: `wsClient.subscribe((event: WsInboundEvent) => { ... })` — **does not filter on `event.type === 'chat.message'`**; accepts any event whose `payload.body` is a string and `payload.userId` matches current user
- Admin auto-subscribe uses channel name `'support'` in `wsClient.ts`; **traders subscribe to `['balances', 'wallet']` only** — user chat delivery is via NATS `chat.user.{userId}` routed to connections by `user_id` (see section D), not via a named WS channel subscription

**History load**

- **Not React Query** — `useEffect` + `getMyChat()` on mount
- API: `GET /v1/users/me/chat` (`getMyChat` in `src/features/terminal/api/chat.api.ts`)

**Auto-scroll**

- `useEffect` on `[messages.length]`: `scrollRef.current?.scrollTo({ top: scrollHeight, behavior: 'smooth' })`

**Typing indicators**

- N/A — not found

**Empty state**

- `MessageCircle` icon `h-10 w-10 mb-3 opacity-50`
- Copy: "No messages yet" / "Send a message to start a conversation with support."

**Dedup**

- `knownIds` ref (`Set<string>`) skips duplicate WS messages by `id`

### 3. Message data shapes (verbatim)

**API DTO** (`src/features/terminal/api/chat.api.ts` and `src/features/support/api/supportChat.api.ts`):

```typescript
export interface ChatMessageDto {
  id: string
  senderType: 'user' | 'support'
  senderId: string | null
  body: string
  createdAt: string
}
```

**UI-local type** (defined inline in `UserSupportPage.tsx`, `SupportPage.tsx`, `ChatPanel.tsx`):

```typescript
type ChatMessage = { id: string; sender: 'support' | 'user'; name: string; text: string; time: string }
```

**WS inbound** (`src/shared/ws/wsEvents.ts`):

```typescript
| {
    type: 'chat.message'
    payload: {
      id: string
      userId: string
      senderType: 'user' | 'support'
      senderId: string | null
      body: string
      createdAt: string
    }
  }
```

**Backend row** (`backend/auth-service/src/routes/chat.rs` — `ChatMessageRow`):

```rust
pub struct ChatMessageRow {
    pub id: String,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub body: String,
    pub created_at: String,
}
```

### 4. Theme tokens used in chat UI

| Token / class | Usage |
|---------------|--------|
| `bg-accent/20`, `border-accent/30`, `text-accent` | User bubbles, send button, live badge |
| `bg-surface-2`, `border-border`, `text-text`, `text-text/90` | Support bubbles, borders |
| `text-text-muted` | Timestamps, empty state, loading |
| `bg-surface/50` | Input footer background |
| `text-red-400/90` | Error text |
| `bg-emerald-500/20 text-emerald-400` | WS "Live" badge |
| `bg-amber-500/20 text-amber-400` | WS connecting/off |
| `rounded-lg`, `px-3 py-2`, `text-xs`, `text-sm` | Bubble typography |
| `max-w-[85%]` | Bubble width cap |
| `space-y-3`, `p-4` | List spacing |

No CVA variants on chat-specific components (plain `cn()` + Tailwind).

### 5. Reusable chat primitives

- **N/A** — no `<ChatBubble>`, `<MessageList>`, or `<ChatInput>` components
- Reuse candidates: `Card`, `Input`, `Button`, `ContentShell`, `PageHeader`, `cn()` from `@/shared/utils`
- `SupportPage` adds conversation list sidebar (`w-72`, `bg-surface-2/30`) — pattern for admin multi-thread UI only

---

## B. Admin Settings Page

### 1. Path and route

- **Component:** `src/features/settings/pages/SettingsPage.tsx`
- **Route:** `/admin/settings` in `src/app/router/adminRoutes.tsx`
- **Nav:** `src/app/config/nav.ts` — `{ label: 'Settings', path: '/admin/settings', permission: 'settings:view' }`
- **Tab deep-link:** `?tab=voiso`, `?tab=integrations`, `?tab=email-config`, etc. via `useSearchParams`

### 2. Section layout (shell JSX)

**Pattern:** Sticky **left sidebar nav** + **right content** (not Radix Tabs component — manual `tab === '...'` conditionals).

```tsx
<ContentShell>
  <PageHeader title={currentMeta.title} description={currentMeta.description} />
  <motion className="mt-6 flex gap-8">
    <nav className="w-56 shrink-0 sticky top-6">
      <ul className="space-y-0.5 rounded-lg border border-border bg-surface-1 p-1">
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
          <button onClick={() => setTab(id)} className={cn(..., tab === id ? 'bg-accent/15 text-accent' : '...')} />
        ))}
      </ul>
    </nav>
    <motion className="min-w-0 flex-1">
      {tab === 'general' && (...)}
      {tab === 'email-config' && (...)}
      {tab === 'integrations' && <IntegrationsSettingsTab canEdit={canEditSettings} />}
      {tab === 'voiso' && <VoisoSettingsTab canEdit={canEditSettings} />}
      {/* other tabs */}
    </motion>
  </motion>
</ContentShell>
```

`SETTINGS_TABS` const at top of file: `general`, `theme`, `email-config`, `email-templates`, `integrations`, `voiso`, `security`.

### 3. Existing sections (one line each)

| Tab id | Description |
|--------|-------------|
| `general` | Site name, support email, currency, timezone, social links (mostly local state; save not wired to API) |
| `theme` | Placeholder ("coming soon") |
| `email-config` | SMTP host/port/encryption/credentials, from address, test email — `getEmailConfig` / `updateEmailConfig` |
| `email-templates` | Table of templates + edit modal — `getEmailTemplates` / `updateEmailTemplate` |
| `integrations` | Data provider integrations (Binance/MMDPS) — `IntegrationsSettingsTab` |
| `voiso` | Voiso API key, Click2Call URL, panel URL, enabled toggle — `VoisoSettingsTab` |
| `security` | Placeholder ("coming soon") |

### 4. How to add a new section

1. Add entry to `SETTINGS_TABS` array (id, label, lucide `icon`)
2. Add `tabMeta` entry for `PageHeader` title/description
3. Add `{tab === 'your-tab' && (...)}` block in content column
4. Optional: extract to `src/features/settings/components/YourSettingsTab.tsx` (like `VoisoSettingsTab`)
5. Gate edits with `useCanAccess('settings:edit')` → `canEditSettings` prop

No central registration array beyond `SETTINGS_TABS`.

### 5. Form patterns

- **Library:** `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`)
- **Validation:** Mostly imperative checks in handlers (e.g. port 1–65535); **not zod** on settings pages
- **Example mutation** (`saveEmailConfigMutation`):

```typescript
const saveEmailConfigMutation = useMutation({
  mutationFn: (payload) => updateEmailConfig({ ... }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'email-config'] })
    toast.success('Email configuration saved')
  },
  onError: (err: Error) => toast.error(err.message || '...'),
})
```

- **Toasts:** `toast` from `@/shared/components/common`

### 6. API key / credential pattern (Voiso + MMDPS)

**Voiso** (`src/features/settings/components/VoisoSettingsTab.tsx`):

- State: `apiKeyInput`, `showApiKey` (boolean), `clearApiKeyPending`
- UI: `Input` with `type={showApiKey ? 'text' : 'password'}`, toggle buttons `Eye` / `EyeOff`
- Badge: `apiKeyConfigured` from API (never returns secret)
- Save: `updateVoisoConfig` — only sends `apiKey` if user typed new value or clear flag; empty field on save = leave unchanged
- **Endpoint:** `PUT /api/admin/settings/voiso` (`src/features/settings/api/voisoConfig.api.ts`)
- **Table:** `platform_voiso_config.api_key` (TEXT, plaintext in DB per migration comment)

**MMDPS** (`IntegrationsSettingsTab` + `DataProviderIntegrationsService`):

- Column: `platform_data_provider_integrations.mmdps_api_key` (TEXT)
- **Endpoint:** `PUT /api/admin/settings/data-providers`
- On save: `DataProviderIntegrationsService::apply_mmdps_api_key_from_request` + `sync_to_redis`
- GET never returns key; returns `mmdpsApiKeyConfigured: boolean`

**Email SMTP password:** `type="password"`, blank = keep existing (`put_email_config`).

---

## C. Backend: Third-Party Integrations

### 1. Table structures

**`platform_voiso_config`** (`infra/migrations/053_platform_voiso_config.sql`)

| Column | Type |
|--------|------|
| `singleton_id` | SMALLINT PK, CHECK = 1 |
| `api_key` | TEXT (nullable) |
| `click2call_url` | TEXT NOT NULL DEFAULT `'https://cc-ams03.voiso.com/api/v1'` |
| `panel_url` | TEXT NOT NULL DEFAULT `'https://cc-ams03.voiso.com/omnichannel/embedded'` |
| `enabled` | BOOLEAN NOT NULL DEFAULT true |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |

**`platform_data_provider_integrations`** (`infra/migrations/050_platform_data_provider_integrations.sql` + `052_platform_mmdps_api_key_column.sql`)

| Column | Type |
|--------|------|
| `singleton_id` | SMALLINT PK, CHECK = 1 |
| `config_json` | JSONB NOT NULL |
| `mmdps_api_key` | TEXT (nullable, added in 052) |
| `updated_at` | TIMESTAMPTZ |

### 2. Auth-service routes

| Resource | File | Functions | Method | Path | Permission |
|----------|------|-----------|--------|------|------------|
| Settings hub | `backend/auth-service/src/routes/admin_settings.rs` | `create_admin_settings_router` | — | nested at `/api/admin/settings` | — |
| Voiso | same | `get_voiso_config`, `put_voiso_config` | GET, PUT | `/api/admin/settings/voiso` | `settings:view` / `settings:edit` via `check_settings_permission` |
| Data providers | same | `get_data_providers`, `put_data_providers`, `post_test_data_providers_ws` | GET, PUT, POST | `/api/admin/settings/data-providers`, `.../test-ws` | same |
| Email | same | `get_email_config`, `put_email_config`, etc. | various | `/api/admin/settings/email-config`, ... | same |

Mounted in `backend/auth-service/src/lib.rs`:

```rust
.nest("/api/admin/settings", create_admin_settings_router(pool.clone())...)
```

### 3. Outbound third-party call (Voiso)

**File:** `backend/auth-service/src/routes/admin_voiso.rs` (Click2Call handler ~line 293)

**Pattern:** `reqwest::Client::new()` then `.post(url).form(&[("agent", ...), ("number", ...)])`

**Signature context:** Not a shared service struct — HTTP inline in route handler after loading `platform_voiso_config` + resolving `VOISO_API_KEY` env fallback.

**MMDPS:** `AdminSymbolsService::sync_from_mmdps`, `DataProviderIntegrationsService::resolve_mmdps_api_key` — HTTP elsewhere; config via settings PUT + Redis sync.

### 4. Secret handling

- **Voiso / MMDPS API keys:** Stored as **plaintext TEXT** in Postgres (`053` comment: "Secrets are stored server-side and are never returned by the API")
- **GET responses:** `apiKeyConfigured` / `mmdpsApiKeyConfigured` booleans only
- **Env fallback:** `VOISO_API_KEY`, `MMDPS_API_KEY` if DB empty (`admin_voiso.rs`, `DataProviderIntegrationsService::resolve_mmdps_api_key`)
- **Email SMTP password:** `platform_email_config.smtp_password` TEXT; PUT omits password field to keep existing

No application-layer encryption found in quoted code.

### 5. Reload pattern

**Data providers:** On `PUT /api/admin/settings/data-providers`, `DataProviderIntegrationsService::sync_to_redis` writes Redis key `REDIS_KEY_ADMIN_INTEGRATIONS` (from `contracts`) and publishes `REDIS_CHANNEL_INTEGRATIONS_UPDATED` — **data-provider process should subscribe** (no auth-service restart required).

**Voiso:** Saved to DB on PUT; next Click2Call reads DB per request — **no Redis pub/sub for Voiso**.

**Auth-service startup:** Also runs `DataProviderIntegrationsService::sync_to_redis` once on boot (`lib.rs`).

---

## D. WebSocket Gateway (`ws-gateway`)

### 1. File tree

```
backend/ws-gateway/src/
├── main.rs
├── config.rs
├── auth/
│   ├── mod.rs
│   └── jwt.rs
├── ws/
│   ├── mod.rs
│   ├── server.rs          # GET /ws upgrade
│   ├── session.rs         # auth, subscribe, message loop
│   └── protocol.rs        # ClientMessage, ServerMessage enums
├── stream/
│   ├── mod.rs
│   ├── redis_subscriber.rs
│   └── broadcaster.rs
├── state/
│   ├── mod.rs
│   ├── connection_registry.rs
│   └── call_registry.rs
├── routing/
│   ├── mod.rs
│   └── subscription_router.rs
├── validation/
│   ├── mod.rs
│   └── message_validation.rs
├── health/
│   ├── mod.rs
│   └── health.rs
└── metrics/
    ├── mod.rs
    └── metrics.rs
```

### 2. Connection handshake

**No token in query string.** First client message after connect must be JSON `ClientMessage::Auth { token }`.

From `backend/ws-gateway/src/ws/session.rs`:

```rust
ClientMessage::Auth { token } => {
    let token = token.trim().strip_prefix("Bearer ").unwrap_or(token.trim());
    match jwt_auth.validate_token(token) {
        Ok(claims) => {
            registry.register(Connection { conn_id, user_id: claims.sub.clone(), group_id: claims.group_id.clone(), role: claims.role.clone(), ... });
            // Send ServerMessage::AuthSuccess { user_id, group_id }
        }
    }
}
```

Frontend (`wsClient.ts`): on `onopen`, after 100ms delay, sends `{ type: 'auth', token }` with token from `useAuthStore.getState().ensureValidAccessToken()`.

### 3. Subscription model

**Client sends** (`protocol.rs`):

```json
{ "type": "subscribe", "symbols": ["BTCUSDT"], "channels": ["balances", "deposits"] }
```

- `symbols`: normalized to alphanumeric uppercase (e.g. `EUR/USD` → `EURUSD`)
- `channels`: validated against `["tick", "positions", "orders", "risk"]` when non-empty; **empty `channels` = price ticks only**

**Server responds:** `ServerMessage::Subscribed { symbols }` or errors with `type: "error"`.

**Envelope:** serde `tag = "type"` on both `ClientMessage` and `ServerMessage` enums.

### 4. Existing channels / delivery paths

| Mechanism | Pattern | Purpose |
|-----------|---------|---------|
| Redis pub/sub | `price:ticks` | Ticks → symbol subscribers |
| Redis | `orders:updates`, `positions:updates`, `risk:alerts` | Trading updates (via broadcaster) |
| Redis | `deposits:requests`, `deposits:approved` | Admin deposit notifications |
| Redis | `notifications:push` | User notifications |
| Redis | `wallet:balance:updated` | Balance pushes |
| Redis | `account:summary:updated` | Account summary JSON broadcast |
| NATS | `chat.>` | Support chat (`chat.support`, `chat.user.{uuid}`) |
| WS client `subscribe` channels | `deposits`, `notifications`, `support` (admin); `balances`, `wallet` (user) | **Logical names** — chat uses NATS path above, not Redis channel list |

**NATS chat subjects** (from `chat.rs` + `main.rs`):

- `chat.support` → all admin connections (`get_admin_connection_ids`)
- `chat.user.{user_id}` → that user's connections + admins

### 5. End-to-end example (support chat)

1. **Publisher** (`backend/auth-service/src/routes/chat.rs` `post_my_chat`):

```rust
let payload = serde_json::json!({
    "type": "chat.message",
    "payload": { "id", "userId", "senderType", "body", "createdAt", ... }
});
deposits_state.nats.publish("chat.support", payload_bytes).await;
deposits_state.nats.publish(format!("chat.user.{}", user_id), payload_bytes).await;
```

2. **ws-gateway** (`main.rs`): NATS subscriber on `chat.>`, builds `ServerMessage::ChatMessage { payload }`, calls `broadcaster.send_to_connections(&conn_ids, ws_msg)`.

3. **Client** receives JSON `{ "type": "chat.message", "payload": { ... } }`.

**Redis balance example:** auth-service `conn.publish("account:summary:updated", &json)` → ws-gateway Redis subscriber → broadcaster → user connections.

### 6. Per-user routing

`ConnectionRegistry` (`connection_registry.rs`):

- `connections: DashMap<Uuid, Connection>`
- `user_connections: DashMap<String, Vec<Uuid>>` keyed by **normalized** `user_id` (lowercase, no dashes)
- `get_user_connections(user_id)` → connection IDs for direct send
- `get_admin_connection_ids()` for admin broadcast paths
- `get_symbol_subscribers(symbol)` for ticks

`Broadcaster::send_to_connections` fans out to per-connection mpsc channels registered at connect.

### 7. Backpressure / rate limiting

- **Config exists:** `LimitsConfig` in `config.rs` — `max_message_size_bytes`, `max_requests_per_second`, `rate_limit_burst`, `max_symbols_per_client`
- **Enforced in code found:** `validate_message_size`, subscribe symbol count, token length (`message_validation.rs`)
- **Per-connection outbound:** `mpsc::channel::<ServerMessage>(WS_CONN_CHANNEL_CAP)` in `session.rs` (`broadcaster.rs` defines cap)
- **Rate limit fields:** Present in config/env; **no grep hits for runtime rate-limit enforcement** in `session.rs` beyond validation — treat as **partially implemented / config-only** unless extended

---

## E. Permissions System

### 1. Where `permission_key` list is defined

- **DB seed:** `permissions` table — migrations e.g. `backend/auth-service/migrations/20260307100000_create_permission_definitions.sql`, `infra/migrations/019_permission_definitions.sql`, plus incremental `INSERT INTO permissions` files
- **Not a Rust const** — runtime checks query `permission_profile_grants`
- **Registration pattern example** (`20260307360000_add_support_new_chat_permission.sql`):

```sql
INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('support:new_chat', 'New chat', 'a0000003-0000-0000-0000-000000000003', 3)
ON CONFLICT (permission_key) DO NOTHING;
```

### 2. Migration pattern for new permissions

- **Production deploy:** `infra/migrations/` (applied by `deploy/docker-compose.prod.yml` migrations container)
- **Auth-service dev:** `backend/auth-service/migrations/` (sqlx; keep in sync)
- **Naming:** `NNN_descriptive_snake.sql` or `YYYYMMDDHHMMSS_description.sql` (e.g. `20260519130000_user_events_device.sql`)
- **Style:** Up-only `INSERT ... ON CONFLICT DO NOTHING`; optional grant to "Full Access" profile (see `054_user_events.sql`)

### 3. Frontend nav gating (`src/app/config/nav.ts`)

```typescript
{ label: 'Support', path: '/admin/support', icon: Headphones, permission: 'support:view' },
{ label: 'Settings', path: '/admin/settings', icon: Settings, permission: 'settings:view' },
```

Filtered elsewhere via `useCanAccess(permission)` (`@/shared/utils/permissions`).

### 4. Category for AI features

- **Existing categories** (seed): `Trading & Finance`, `Support`, `Users & Groups`, `Configuration`, `Risk & Reports`, `Other Admin`, plus later `KYC`, `Leads`, `Appointments`, `Managers`, `Tags`, `Call`, etc.
- **Recommendation from codebase patterns:**
  - **Admin AI settings** (API key, model): add keys under **`Configuration`** (same as `promotions:view`, `settings:edit`) — tab in `SettingsPage`
  - **User-facing AI chat** (if admin-gated): could use **`Support`** or new category **`AI`** — no `ai:*` keys exist yet; would need new `permission_categories` row + migrations

---

## F. User Context for AI

### 1. Account summary

| Item | Detail |
|------|--------|
| **Redis key** | `pos:summary:{user_id}` via `redis_model::keys::Keys::account_summary(user_id)` / `Keys::position_summary(user_id)` (alias) |
| **Storage shape** | Redis **HASH** fields: `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `margin_call_level_threshold`, `stop_out_level_threshold`, `liquidation_level`, `realized_pnl`, `unrealized_pnl`, `updated_at` (strings); also full JSON published on pub/sub channel |
| **Struct** | `AccountSummary` in `deposits.rs` (camelCase JSON when serialized) |
| **Read fn** | `compute_and_cache_account_summary(pool, redis, user_id)` / `get_account_summary` handler; HGET `free_margin` used in `place_order` |
| **Cost** | Redis HGET/HGETALL — **cheap**; full recompute is **expensive** (DB aggregates + all open positions from Redis) |

```rust
pub async fn compute_and_cache_account_summary(
    pool: &PgPool,
    redis: &crate::redis_pool::RedisPool,
    user_id: Uuid,
) { ... }
```

### 2. Open positions

| Item | Detail |
|------|--------|
| **HTTP handler** | `get_user_positions` in `backend/auth-service/src/routes/deposits.rs` |
| **Path** | `GET /v1/users/:user_id/positions` |
| **Signature** | `async fn get_user_positions(State(pool), Extension(claims), Extension(deposits_state), Path(user_id), Query(query)) -> Result<Json<PositionsResponse>, StatusCode>` |
| **Implementation** | `SMEMBERS` on `Keys::positions_set(user_id)`, then `HGETALL` per `Keys::position_by_id(id)` from Redis |
| **Cost** | **Redis multi-key** — moderate; scales with open position count |

### 3. Recent orders

| Item | Detail |
|------|--------|
| **HTTP handler** | `list_orders` in `backend/auth-service/src/routes/orders.rs` |
| **Path** | `GET /api/orders` or `/v1/orders` |
| **Frontend** | `listOrders({ status, limit })` in user panel |
| **Cost** | **SQL** against `orders` table (joined `symbols`) — moderate; paginated |

### 4. User profile basics

| Item | Detail |
|------|--------|
| **Service** | `AuthService::get_user_by_id(user_id: Uuid) -> anyhow::Result<User>` in `backend/auth-service/src/services/auth_service.rs` |
| **SQL** | `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL` |
| **Fields on `User` model** | includes `role`, `group_id`, `kyc_status`, `trading_access`, `account_type`, `margin_calculation_type`, etc. (sqlx model) |
| **Cost** | **Single SQL** — cheap |

### 5. Symbols catalog

| Item | Detail |
|------|--------|
| **Public list** | `GET /api/symbols` → `list_symbols` in `backend/auth-service/src/routes/symbols.rs` |
| **Service** | `AdminSymbolsService::list_symbols(...)` in `backend/auth-service/src/services/admin_symbols_service.rs` |
| **Admin** | `GET /api/admin/symbols` with permissions |
| **Leverage** | Per-user/symbol via `GET /api/auth/me/symbol-leverage?symbol_code=` |
| **Cost** | **SQL** with filters/pagination — moderate |

---

## G. Existing AI / LLM Code

Search: `anthropic|openai|claude|gpt|llm|chatgpt` in `*.rs`, `*.ts`, `*.tsx`, `*.sql` (case-insensitive).

**Findings:** No matches indicating Anthropic/OpenAI/Claude/GPT integration.

**Note:** Unrelated hits only (e.g. `MarginCallModal`, `IncomingCallModal`, `closeAllModals`).

**Conclusion:** **No existing AI/LLM integration** in application code.

---

## H. Rate Limiting & Idempotency

### 1. Rate limiting (auth-service)

- **No global Axum rate-limit middleware** found in auth-service
- **ws-gateway:** `MAX_REQUESTS_PER_SECOND`, `RATE_LIMIT_BURST` in config — see section D.7
- **Order placement:** Business rules (min margin, free margin) — not request rate

### 2. Idempotency pattern (`place_order`)

**File:** `backend/auth-service/src/routes/orders.rs`

**Request field:** `idempotency_key: String` on `PlaceOrderRequest`

**Redis key used in place_order** (note: differs from `Keys::idempotency` helper):

```rust
let idempotency_key = format!("order:idempotency:{}", req.idempotency_key);
let existing_order_id: Option<String> = conn.get(&idempotency_key).await?;
if let Some(existing_id) = existing_order_id {
    return Ok(Json(PlaceOrderResponse { order_id: existing_id, status: "PENDING".to_string() }));
}
let _: () = conn.set_ex(&idempotency_key, order_id.to_string(), 86400).await?;
```

**`Keys::idempotency`** in `crates/redis-model/src/keys.rs`: `idempo:{user_id}:{key}` — used elsewhere; AI chat could mirror **either** pattern consistently.

---

## I. Audit Logging

### 1. Table usage

| Table | Purpose in code |
|-------|-----------------|
| **`audit_logs`** | Auth lifecycle via `AuthService::log_audit` — `actor_user_id`, `action`, `meta` |
| **`user_events`** | Richer append-only history for admin UI — `subject_user_id`, `actor_user_id`, `event_type`, `category`, `ip`, `user_agent`, device fields, `meta` |
| **`audit_events`** | Early schema in `infra/migrations/001_initial_schema.sql` — trading-oriented; **not** the primary path in current auth-service handlers reviewed |

### 2. INSERT example (login)

**Dual write on login** (`auth_service.rs`):

```rust
self.log_audit(user.id, "auth.login", login_meta.clone()).await?;
// log_audit:
// INSERT INTO audit_logs (actor_user_id, action, meta) VALUES ($1, $2, $3)

self.record_user_event(user.id, Some(user.id), "auth.login", "auth", ip, user_agent, login_meta).await;
// user_events INSERT via UserEventsService::record
```

### 3. Helper signatures

```rust
// auth_service.rs (private)
async fn log_audit(&self, actor_user_id: Uuid, action: &str, meta: serde_json::Value) -> anyhow::Result<()>

// user_events_service.rs (preferred for new activity types)
pub async fn record_user_event_fail_open(
    pool: &PgPool,
    subject_user_id: Uuid,
    actor_user_id: Option<Uuid>,
    event_type: &'static str,
    category: &'static str,
    ip: Option<String>,
    user_agent: Option<String>,
    meta: JsonValue,
)
```

---

## J. Database Migration Conventions

### 1. Which folder for new prod features

- **Primary for production:** `infra/migrations/` — loop-applied by Docker migrations service
- **Also maintain:** `backend/auth-service/migrations/` for sqlx/local dev parity
- **Rule of thumb from repo:** New platform tables/permissions → **both** or at least `infra/migrations/`

### 2. Latest filename examples

```
infra/migrations/055_user_events_device.sql
infra/migrations/054_user_events.sql
backend/auth-service/migrations/20260519130000_user_events_device.sql
backend/auth-service/migrations/20260519120000_user_events.sql
```

Formats: `NNN_snake_case.sql` (infra) and `YYYYMMDDHHMMSS_snake_case.sql` (auth-service).

### 3. Up-only or up+down?

- **Up-only** — `INSERT ... ON CONFLICT`, `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **No DOWN sections** in sampled migrations

---

## K. Frontend State & Routing

### 1. New user-panel route

From `src/app/router/userRoutes.tsx`:

```typescript
export const userRoutes: RouteObject[] = [
  { path: '/user/dashboard', element: <UserDashboardPage /> },
  // ...
  { path: '/user/support', element: <UserSupportPage /> },
]
```

Wrapped in `AppRouter.tsx`:

```typescript
...userRoutes.map((route) => ({
  ...route,
  element: (
    <AuthGuard>
      <UserGuard>
        <UserLayout>{route.element}</UserLayout>
      </UserGuard>
    </AuthGuard>
  ),
})),
```

Also add to `userNavItems` in `src/app/config/nav.ts`.

### 2. New admin-panel route

From `src/app/router/adminRoutes.tsx` + `adminNavItems` in `nav.ts` with `permission: '...'`.

Settings-only features use **tab** on existing `/admin/settings` (no new route).

### 3. Zustand stores

**`src/shared/store/auth.store.ts`** — global auth only (`accessToken`, `refreshToken`, `user`, `login`, `logout`, `hydrateFromStorage`, etc.)

**Feature stores:** e.g. `src/features/terminal/store` (terminal UI). **No** `src/features/*/store` convention everywhere — support chat uses **local `useState`** only.

### 4. React Query example

From `src/features/userPanel/hooks/useProfile.ts`:

```typescript
export const profileQueryKey = ['profile', 'me'] as const

export function useProfile() {
  return useQuery({
    queryKey: profileQueryKey,
    queryFn: me,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload) => updateProfile(payload),
    onSuccess: (data) => { queryClient.setQueryData(profileQueryKey, data); toast.success('...') },
    onError: (err) => toast.error(...),
  })
}
```

Orders list pattern (`UserOrdersPage.tsx`): `queryKey: ['user', 'orders', 'pending']`, `queryFn: () => listOrders({ status: 'pending', limit: 100 })`.

---

## L. Theme & Design Tokens

### 1. Tailwind `theme.extend` (`tailwind.config.js` lines 12–58)

**Note:** File contains corrupted trailing content after line 61 in workspace — use only the legitimate `export default { ... }` block when editing.

```javascript
extend: {
  colors: {
    background: '#0b1220',
    surface: '#111a2b',
    'surface-1': '#1a2332',
    'surface-2': '#0f172a',
    border: 'rgba(255, 255, 255, 0.08)',
    text: '#e5e7eb',
    'text-muted': '#94a3b8',
    'text-dim': '#94a3b8',
    muted: '#94a3b8',
    accent: '#3b82f6',
    accentBlue: '#3b82f6',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b',
    info: '#06b6d4',
  },
  borderRadius: { DEFAULT: '12px', sm: '10px' },
  gridTemplateColumns: { app: '280px 1fr 320px', main: 'repeat(12, minmax(0, 1fr))' },
  // keyframes: fade-in, slide-up, slide-down
}
```

No custom `fontFamily` in extend — body uses system stack in CSS.

### 2. CSS variables

**N/A** — no `--background` CSS variables in `src/shared/styles/globals.css`. Theme is **Tailwind hex colors** + direct rules:

```css
body {
  background-color: #0b1220;
  color: #e5e7eb;
  background: linear-gradient(135deg, #0b1220 0%, #0f172a 100%);
}
```

### 3. Shared UI primitives

| Component | Path | Variants |
|-----------|------|----------|
| `Button` | `src/shared/ui/button/Button.tsx` | `variant`: primary, secondary, ghost, outline, success, danger; `size`: sm, default, lg, icon |
| `Input` | `src/shared/ui/input/Input.tsx` | standard input styling |
| `Card` | `src/shared/ui/card/Card.tsx` | wrapper |
| `ModalShell` | `src/shared/ui/modal/ModalShell.tsx` | sizes |
| `Tabs` | `src/shared/ui/tabs/Tabs.tsx` | exists but Settings uses custom sidebar |
| `Select` | `src/shared/ui/select/Select.tsx` | Radix-based |
| `dialog` | `src/shared/ui/dialog.tsx` | Radix dialog |

### 4. Icons

- **lucide-react** throughout (e.g. `MessageCircle`, `Send`, `Loader2`)
- No custom icon pack found in chat paths

---

## M. Notes for Real-Time Streaming AI Chat

**Helps**

- **`ChatPanel.tsx`** already embeds support-style chat in the terminal (`useTerminalStore().chatPanelOpen`) — natural place for AI alongside human support
- **NATS + ws-gateway chat pipeline** exists: publish JSON → `chat.user.{id}` → `ServerMessage::ChatMessage` — can extend for streaming token chunks (new `type` e.g. `ai.message.delta`)
- **Postgres pattern** for messages: `support_messages` table is simple (user_id thread, body text) — clone for `ai_messages` or generalize with `channel` column
- **Settings tab pattern** ready for provider API keys (Voiso/MMDPS precedent + Redis sync for workers)
- **`record_user_event_fail_open`** for audit without blocking chat
- **`compute_and_cache_account_summary` + `get_user_positions`** give read-only trading context without placing orders
- **Workspace rule:** no polling — streaming over WS fits policy; use SSE only if WS unsuitable
- **Idempotency + `knownIds` dedup** patterns in UI/backend for message sends

**Complicates**

- **No shared chat primitives** — expect duplication or need to extract components first
- **Support chat is not token-streaming** — full message on insert; AI needs new protocol types and partial UI render
- **Trader WS subscribe** does not include a `support`/`ai` channel name — must route via NATS per-user subjects (like chat today) or extend `wsClient` auto-subscribe
- **`Keys::idempotency` vs `order:idempotency:`** inconsistency — pick one pattern for AI send dedup
- **API keys plaintext in DB** — security/compliance decision for LLM provider keys
- **auth-service is monolith** for HTTP — AI orchestration likely new module in auth-service or separate worker subscribing to NATS
- **Dual migration folders** — must add SQL to `infra/migrations/` and likely auth-service migrations
- **No rate limiting on auth HTTP** — AI endpoints need explicit limits/cost controls
- **Terminal `ChatPanel` width** fixed `288px` desktop — streaming UX constrained
- **`tailwind.config.js` corruption** at EOF — fix before relying on build tooling
- **core-api / order-engine** do not own chat — all new AI HTTP should target **auth-service** (port 3000) per production compose

---

*End of diagnostic. Pair with `docs/KNOWLEDGE_TRANSFER.md` for broader platform context.*
