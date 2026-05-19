# NEWPT Admin User Report Generator — Codebase Diagnostic

> Generated from repo `/Users/mab/new_pt1`. All paths, names, and snippets are from this codebase unless marked **N/A — not found**.

---

## A. Admin Users List Page

### 1. File path and route

| Item | Value |
|------|--------|
| **Page component** | `src/features/adminUsers/pages/AdminUsersPage.tsx` — export `AdminUsersPage` |
| **Route** | `/admin/users` in `src/app/router/adminRoutes.tsx` |
| **Nav** | `src/app/config/nav.ts` — `{ label: 'Users', path: '/admin/users', permission: 'users:view' }` |

```37:38:src/app/router/adminRoutes.tsx
    path: '/admin/users',
    element: <AdminUsersPage />,
```

### 2. Table implementation

**Stack:** `@tanstack/react-table` `ColumnDef<User>` wrapped by shared `DataTable` (`useReactTable`). **Not virtualized** — standard `<table>` with mapped rows. (`@tanstack/react-virtual` is in `package.json` but not used here.)

**Component:** `src/features/adminUsers/components/UsersTable.tsx`

**Column pattern (sample):**

```268:308:src/features/adminUsers/components/UsersTable.tsx
  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'id',
      header: 'User ID',
      cell: ({ row }) => {
        const user = row.original
        return (
          <button
            type="button"
            className="font-mono text-sm whitespace-nowrap text-left text-accent hover:underline cursor-pointer bg-transparent border-0 p-0"
            onClick={(e) => {
              e.stopPropagation()
              handleView(user)
            }}
            title="View user details"
          >
            {row.getValue('id') as string}
          </button>
        )
      },
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const user = row.original
        return (
          <button
            type="button"
            className="font-semibold text-text whitespace-nowrap text-left hover:underline cursor-pointer bg-transparent border-0 p-0"
            onClick={(e) => {
              e.stopPropagation()
              handleView(user)
            }}
```

Full column keys: `id`, `name`, `email`, `groupName`, `accountType`, `marginCalculationType`, `tradingAccess`, `leverage` (id only), `country`, `balance`, `marginLevel`, `status`, `kycStatus`, `createdAt`, `actions` (id only).

### 3. Row click behavior

**Opens a drawer modal** (not a route). `UsersTable.handleView` → `openModal` with `variant: 'drawer'`.

```182:186:src/features/adminUsers/components/UsersTable.tsx
  const handleView = (user: User) => {
    openModal(`user-details-${user.id}`, <UserDetailsModal user={user} />, {
      variant: 'drawer',
    })
  }
```

`DataTable` passes `onRowClick={handleView}`; ignores clicks on `button`, `[role="button"]`, `[role="combobox"]`, `a`, `input`, `select`, `[data-no-row-click]` (`src/shared/ui/table/DataTable.tsx`).

### 4. Bulk selection

**N/A — not found** on the admin users list. No checkbox column, no `rowSelection`, no selected-users state in `AdminUsersPage` / `UsersTable`.

Reference bulk-select exists on `src/features/symbols/components/SymbolsTable.tsx` (`id: 'bulkSelect'`).

### 5. Bulk action toolbar

**N/A — not found** on the users list (no “selected N users” bar).

Bulk user ops live on **`/admin/bulk-operations`** → `AdminBulkOperationsPage` (`BulkDepositSection`, `BulkPositionSection`).

### 6. Per-row action menu (kebab)

**N/A — not found.** Actions are a **horizontal row of ghost `Button`s** with Lucide icons in column `id: 'actions'` (`Bell`, `LogIn`, `Eye`, `Edit`, `Shield`, `X`). No `DropdownMenu` / `MoreVertical`.

Handlers: `handleSendNotification`, `handleLoginAsUser`, `handleView`, `handleEdit`, `handleRestrict`, `handleDisable` (last is toast-only stub).

### 7. Filters and query params

**UI state** (`AdminUsersPage` — not synced to URL):

```62:70:src/features/adminUsers/pages/AdminUsersPage.tsx
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    kycStatus: 'all',
    group: 'all',
    country: 'all',
    balanceMin: '',
    balanceMax: '',
  })
```

**`UserFiltersBar`** (`src/features/adminUsers/components/UserFiltersBar.tsx`): `search`, `status`, `kycStatus`, `group`, `country`, `balanceMin`, `balanceMax`.

**Server-side** via `listUsers` → `GET /api/auth/users`:

| UI field | API param | When sent |
|----------|-----------|-----------|
| debounced search (400ms) | `search` | non-empty |
| `status` | `status` | not `'all'` |
| `group` | `group_id` | not `'all'` |
| `country` | `country` | not `'all'` |
| pagination | `page`, `page_size` | always |

**Client-only** (current page): `kycStatus`, `balanceMin`, `balanceMax` in `filteredDisplayUsers` `useMemo` — KYC filter is ineffective today because list maps `kycStatus: 'none' // TODO`.

**Not supported:** `tag_id`, URL query params on list page. Dead link: `AdminLeadDetailPage` links to `/admin/users?user=...` but list page does not read `user`.

---

## B. Admin User Detail Page

### 1. Dedicated detail page?

**N/A — no `/admin/users/:id` route.**

User detail = **drawer modal**: `src/features/adminUsers/modals/UserDetailsModal.tsx` (`UserDetailsModal`), opened from list row/cell/actions, `UserSearchPalette`, etc.

### 2. Layout structure (shell JSX)

Drawer content is **custom layout inside `ModalShell` variant `drawer`** — not using Radix tabs for the shell; header + metrics bar + tab buttons + `TabsContent` regions.

```990:1024:src/features/adminUsers/modals/UserDetailsModal.tsx
  return (
    <>
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-700">
        <motion.div className="flex items-center justify-between p-3 sm:p-4 md:p-6">
          ...
        </motion.div>
      </header>

      {/* Metrics bar */}
      <motion.div className="flex-shrink-0 border-t border-slate-700/50 bg-slate-800/50 px-3 pt-3 pb-3 sm:px-4 sm:pt-4 sm:pb-4">
        ...
      </motion.div>
```

Drawer chrome: `ModalShell` with `variant: 'drawer'` → `h-[95vh]`, `max-w-5xl`, `bg-slate-800`, `border-slate-700` (`src/shared/ui/modal/ModalShell.tsx`).

### 3. Existing tabs/sections

`TAB_VALUES` in `UserDetailsModal.tsx`:

| Tab value | Label | Description |
|-----------|-------|-------------|
| `overview` | Overview | Profile fields, “View event history”, footer Edit/Reset Password |
| `funding` | Funding History | `fetchTransactions` by user email; approve/reject pending |
| `appointments` | Appointments | `getAppointments({ user_id })` |
| `orders-positions` | Orders & Positions | Subtabs: `positions`, `orders`, `pending`, `closed` |
| `notes` | Notes & Timeline | `fetchUserNotes` / `createUserNote` |
| `chat` | Chat | Admin support chat via `getAdminConversationMessages` |

**Orders subtab note:** `orders` and `pending` UI show **static empty placeholders** (“No orders” / “No pending orders”) — not wired to `list_admin_orders`. `positions` and `closed` use `getPositionsByUserId`.

### 4. How to add a new tab

Pattern: extend `TAB_VALUES` const array, add entry to the `.map` tab button list (~line 1106), add matching `<TabsContent value="...">`, persist via `sessionStorage` key `admin-user-details-modal-tab` (`getStoredUserDetailsTab` / `setActiveTab`).

No central registry file — **inline array + conditional `TabsContent`**.

### 5. Actions and endpoints

| Action | Where | Endpoint / API |
|--------|-------|----------------|
| View details | List row / Eye | Opens modal (no HTTP) |
| Login as user | `UsersTable.handleLoginAsUser` | `POST /api/admin/users/:id/impersonate` — `impersonateUser` |
| Send notification | `SendNotificationModal` | `POST /api/admin/users/:id/notify` |
| Edit user | `CreateEditUserModal` | `PUT /api/admin/users/:id/profile` |
| Change group (inline/table) | `updateUserGroup` | `PUT /api/admin/users/:id/group` |
| Account type | `updateUserAccountType` | `PUT /api/admin/users/:id/account-type` |
| Margin calc type | `updateUserMarginCalculationType` | `PUT /api/admin/users/:id/margin-calculation-type` |
| Trading access | `updateUserTradingAccess` | `PUT /api/admin/users/:id/trading-access` |
| Permission profile | `updateUserPermissionProfile` | `PUT /api/admin/users/:id/permission-profile` |
| Admin role toggle | `updateUserRole` | `PUT /api/admin/users/:id/role` |
| Account summary | modal query | `GET /api/admin/users/:id/account-summary` |
| Positions | modal | `GET /v1/users/:userId/positions?status=...` |
| Funding txs | modal | `GET /api/admin/finance/transactions?search={email}` |
| Notes | modal | `GET/POST /api/admin/user-notes/:userId` |
| Support chat | modal | `GET/POST /api/admin/chat/conversations/:userId/messages` |
| Reset password OTP | overview footer | `requestPasswordResetOTP` (auth API) |
| View event history | overview | Navigates to `/admin/user-events?userId=...` |
| Create/close/modify positions | orders-positions | `createAdminOrder`, `closeAdminPosition`, `updateAdminPositionParams`, etc. (`/api/admin/...`) |
| Direct deposit | funding tab | `createDirectDeposit` (finance API) |
| Restrict user | `RestrictUserModal` | (see modal; separate from table Shield) |

**Impersonate event:** `admin.impersonate` recorded in `user_events` (`auth_service.rs`).

### 6. Best place for “Generate AI Report”

**Recommendation (based on existing UX):**

1. **Primary:** `UserDetailsModal` **header** (next to close) or **overview** row beside “View event history” — matches per-user context and metrics already loaded.
2. **Secondary:** New tab `reports` in `TAB_VALUES` if reports are long-lived / history list.
3. **Bulk:** Reuse pattern from `BulkDepositSection` on `/admin/bulk-operations` or add list-page toolbar **after** implementing checkbox column (does not exist today).
4. **Avoid** cramming into the icon-only `actions` column without a menu refactor.

---

## C. Data Available About a User

**No `get_admin_user_summary`.** Closest reuse: `build_user_context_json` in `ai_chat.rs` (partial bundle), `get_account_summary_for_user`, `AuthService::get_user_by_id`, `list_users_paginated`.

Cost: **cheap** = 1 indexed SQL or 1 Redis hash; **medium** = several queries or Redis set iteration; **expensive** = global scans / unbounded lists.

### 1. Profile basics

| Item | Value |
|------|--------|
| **Function** | `AuthService::get_user_by_id` |
| **File** | `backend/auth-service/src/services/auth_service.rs` |
| **SQL** | `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL` |
| **Return** | `User` model: `email`, `first_name`, `last_name`, `role`, `status`, `group_id`, `account_type`, `margin_calculation_type`, `trading_access`, `min_leverage`, `max_leverage`, `referral_code`, `referred_by_user_id`, `last_login_at`, `created_at`, `permission_profile_id` |
| **Cost** | cheap |
| **List path** | `GET /api/auth/users` → `list_users_paginated` with joins for `group_name`, `open_positions_count` |
| **Gaps** | No dedicated `GET /api/admin/users/:id`. Frontend list hardcodes `kycStatus: 'none' // TODO`. `User` Rust model has no `max_position_size` / `max_daily_loss` (legacy columns may exist in `database/schema.sql` but not on live `User` struct). |

### 2. Account summary

| Item | Value |
|------|--------|
| **Function** | `get_account_summary_for_user` → Redis `pos:summary:{user_id}` (`Keys::account_summary`) else `compute_account_summary_inner` |
| **File** | `backend/auth-service/src/routes/deposits.rs` |
| **HTTP** | `GET /api/admin/users/:id/account-summary` (`get_admin_user_account_summary`); batch `POST /api/admin/users/account-summaries` |
| **Return** | `AccountSummary`: `balance`, `equity`, `margin_used`, `free_margin`, `margin_level`, `realized_pnl`, `unrealized_pnl`, … |
| **Cost** | cheap (cache hit) / medium (recompute) |

### 3. Open positions

| Item | Value |
|------|--------|
| **Function** | `get_user_positions` (HTTP) / Redis `SMEMBERS pos:{user_id}` + `HGETALL pos:by_id:{id}` |
| **HTTP** | `GET /v1/users/:user_id/positions?status=open` |
| **Frontend** | `getPositionsByUserId(userId)` → same path, default `status=all` in modal |
| **Return** | `{ positions: [...] }` — symbol, side, size, margin, unrealized_pnl, etc. |
| **Cost** | medium (per-user Redis set) |

### 4. Recent orders

| Item | Value |
|------|--------|
| **Function** | `list_admin_orders` or user `list_orders` in `orders.rs` |
| **HTTP** | `GET /api/admin/orders?user_id={uuid}&limit=&cursor=` |
| **SQL** | `orders` JOIN `symbols`; fields include `side`, `type`, `size`, `status`, `filled_at`, `cancelled_at` |
| **Reuse in AI** | `build_user_context_json` — last 5 orders (Postgres) |
| **Cost** | medium |

### 5. Order history aggregates

| Item | Value |
|------|--------|
| **Existing** | Per-status `COUNT(*)` in `orders.rs` (`user_id` + `status`); manager dashboard counts in `admin_managers.rs` (scoped user sets, daily filled/cancelled) |
| **Admin user report** | **No** dedicated fill-rate / cancellation-rate helper for a single user |
| **Sketch** | `SELECT status::text, COUNT(*) FROM orders WHERE user_id = $1 GROUP BY status` + `AVG(size::numeric)` |

### 6. Closed positions / trade history

| Item | Value |
|------|--------|
| **List** | `GET /v1/users/:id/positions?status=closed&limit=200` (Redis); modal filters `status === 'CLOSED'` client-side |
| **Total realized PnL** | `compute_account_summary_inner` — `SUM(realized_pnl)` from `positions` where `status = 'closed'` (`deposits.rs` ~429) |
| **Win/loss / best-worst** | **N/A — not found** as dedicated query |
| **Sketch** | `SELECT COUNT(*) FILTER (WHERE realized_pnl > 0), COUNT(*) FILTER (WHERE realized_pnl < 0), SUM(realized_pnl), MAX(realized_pnl), MIN(realized_pnl) FROM positions WHERE user_id = $1 AND status = 'closed'` (or Redis closed hashes if fields present) |

### 7. Deposits / withdrawals

| Item | Value |
|------|--------|
| **Table** | `transactions` (primary); **`deposit_requests` dropped** (`database/migrations/0004_remove_deposit_requests_table.sql`) |
| **Function** | `list_transactions` in `finance.rs` |
| **HTTP** | `GET /api/admin/finance/transactions?search=` — filters by email/id/reference, **no `userId` param** |
| **Modal** | `fetchTransactions({ search: user.email, pageSize: 100 })` |
| **Per-user SQL** | `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC` (extend API or use in report service) |
| **Cost** | medium |

### 8. Margin events / liquidations

| Item | Value |
|------|--------|
| **Table** | `margin_events` in `database/schema.sql` — columns: `user_id`, `position_id`, `type`, `severity`, `equity`, `margin`, `free_margin`, `maintenance_margin`, `message`, `acknowledged`, `created_at` |
| **API** | **N/A — not found** (no Rust routes) |
| **Cost** | cheap SQL if added: `SELECT * FROM margin_events WHERE user_id = $1 ORDER BY created_at DESC` |

### 9. KYC submissions

| Item | Value |
|------|--------|
| **HTTP** | `GET /api/admin/kyc` (list), `GET /api/admin/kyc/:id` (detail) |
| **Per-user SQL** | `SELECT status, submitted_at, rejection_reason, reviewed_at FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1` (used in `build_user_context_json`) |
| **Detail shape** | `KycSubmissionDetail`: `status`, `submitted_at`, `reviewed_at`, `rejection_reason`, `documents[]` — **no separate “reviewer notes” field** beyond `rejection_reason` |
| **Cost** | cheap |

### 10. Support history

| Item | Value |
|------|--------|
| **HTTP** | `GET /api/admin/chat/conversations` — summaries with `lastMessage`, `lastTime`; `GET /api/admin/chat/conversations/:user_id/messages` |
| **Count / last date** | **N/A — no count-only endpoint**; derive from messages list or add `COUNT(*), MAX(created_at)` on chat messages table in report SQL |
| **Cost** | medium |

### 11. Login / activity history (`user_events`)

**Table** (`backend/auth-service/migrations/20260519120000_user_events.sql`): `subject_user_id`, `actor_user_id`, `event_type`, `category`, `ip`, `user_agent`, `meta`, `created_at`.

**Recorded types (found in code):**

| event_type | category / notes |
|------------|------------------|
| `auth.register` | auth |
| `auth.login` | auth |
| `auth.logout` | auth |
| `auth.password_reset` | auth |
| `auth.session_created` | backfill only |
| `admin.impersonate` | admin |
| `finance.deposit_approved` | finance |
| `finance.deposit_rejected` | finance |
| `ai.message.blocked` | AI chat |
| `ai.message.completed` | AI chat |

**Read:** `UserEventsService::list` → `GET /api/admin/user-events?user_id=&category=&event_type=&from=&to=&cursor=&limit=`

**Sample SQL (last 30 days):**

```sql
SELECT event_type, category, actor_user_id, ip, meta, created_at
FROM user_events
WHERE subject_user_id = $1
  AND created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC
LIMIT 100;
```

**Cost:** cheap–medium (indexed on `subject_user_id, created_at`).

### 12. Tags assigned

| Item | Value |
|------|--------|
| **SQL** | `SELECT tag_id FROM tag_assignments WHERE entity_type = 'user' AND entity_id = $1` |
| **Used in** | `admin_swap.rs`, `scoped_access.rs`, `admin_tags.rs` |
| **Dedicated GET** | **N/A — not found** |
| **Cost** | cheap |

### 13. Affiliate / referral

| Item | Value |
|------|--------|
| **On user row** | `referral_code`, `referred_by_user_id` (`users` table) |
| **Referrer chain** | `referred_by_user_id` → parent user |
| **Referred count** | `GET /api/admin/affiliate/users` — `list_affiliate_users` aggregates `COUNT(*)` grouped by `referred_by_user_id` |
| **Commission earned** | `affiliate_commissions` joined in `GET /api/auth/me/commissions` (self); **no admin per-user commission summary endpoint** found |
| **Cost** | cheap–medium |

### 14. Risk-related data

| Item | Value |
|------|--------|
| **User-level (schema.sql legacy)** | `max_position_size`, `max_daily_loss`, `max_leverage_cap`, `risk_flag`, `trading_enabled`, `close_only_mode` on `users` in canonical schema |
| **Live Rust `User` model** | `trading_access`, `min_leverage`, `max_leverage` only |
| **Group-level** | `user_groups`: `max_leverage_cap`, `max_position_size`, `max_daily_loss`, margin/stop-out levels — via `GET /api/admin/groups/:id` |
| **Symbol overrides** | `risk_limits` table (group/user/symbol scoped) in schema |
| **Frontend list** | `riskFlag`, `maxDailyLoss`, etc. are **TODO placeholders** in `mapUserResponse` |
| **Cost** | cheap per table query |

### Existing helpers to reuse for reports

| Helper | Path |
|--------|------|
| `build_user_context_json` | `backend/auth-service/src/routes/ai_chat.rs` — profile, KYC, summary, open symbols, 5 orders |
| `get_account_summary_for_user` | `deposits.rs` |
| `get_user_by_id` | `auth_service.rs` |
| `UserEventsService::list` | `user_events_service.rs` |
| `list_admin_orders` | `admin_trading.rs` |
| `get_user_positions` | `deposits.rs` |

---

## D. Existing AI Module

### 1. Provider trait

**File:** `backend/auth-service/src/services/ai/provider.rs`

```25:34:backend/auth-service/src/services/ai/provider.rs
#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn stream_chat(
        &self,
        system: String,
        messages: Vec<AiMessage>,
        max_tokens: u32,
        tx: Sender<AiDelta>,
    ) -> anyhow::Result<AiUsage>;
}
```

### 2. AnthropicProvider

**File:** `backend/auth-service/src/services/ai/anthropic.rs`

- **Non-streaming:** `AnthropicProvider::complete` — `"stream": false` — used by topic guard + admin AI config test.
- **Streaming:** `impl AiProvider for AnthropicProvider` → `stream_chat` → `post_stream` + `parse_sse_stream`.
- **For reports:** Can use `stream_chat` and aggregate `AiDelta::Text` server-side, or call `complete` for non-streaming (not on trait today).

### 3. AiConfigService model selection

**File:** `backend/auth-service/src/services/ai/config_service.rs`

- Single global row `platform_ai_config`: `model`, `classifier_model`.
- Chat uses `config.model` via `provider_from_key(api_key, config.model.clone())`.
- **No per-call model override** in `AiConfigService` — to use Opus for reports vs Sonnet for chat, pass a different model string when constructing `AnthropicProvider::new` in the new report route (bypass or extend config).

### 4. NATS subject pattern

**Confirmed:** `ai.chat.user.{user_id}` in `publish_ai_event` (`ai_chat.rs`).

**Proposal for admin reports** (consistent, avoids collision with end-user chat):

- Publish: `ai.report.admin.{admin_user_id}` or `ai.report.subject.{subject_user_id}.admin.{admin_user_id}` if multiple admins can stream reports on same subject concurrently.
- ws-gateway today subscribes `ai.chat.>` and strips `ai.chat.user.` — **new subscriber** needed for `ai.report.>` with routing to admin connection IDs only.

### 5. ws-gateway protocol

```170:174:backend/ws-gateway/src/ws/protocol.rs
    #[serde(rename = "ai.chat.delta")]
    AiChatDelta {
        payload: serde_json::Value,
    },
```

Frontend: `src/shared/ws/wsEvents.ts` — `type: 'ai.chat.delta'`. Consumer: `src/features/terminal/components/AiChatTab.tsx`.

**New variant suggestion:** `ai.report.delta` with same payload shape (`delta` | `done` | `error` | `message`).

### 6. Idempotency, rate-limit, daily-cap (`ai_chat.rs`)

```359:424:backend/auth-service/src/routes/ai_chat.rs
async fn check_rate_limit(
    redis: &crate::redis_pool::RedisPool,
    user_id: Uuid,
    limit: i32,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let epoch_minute = Utc::now().timestamp() / 60;
    let key = format!("ai:rate:{}:{}", user_id, epoch_minute);
    // INCR ... if count > limit → RATE_LIMITED
}

async fn check_daily_cap(
    pool: &PgPool,
    user_id: Uuid,
    cap: i32,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    // ai_usage_daily ... if used >= cap → DAILY_CAP_EXCEEDED
}
```

```533:555:backend/auth-service/src/routes/ai_chat.rs
    // Idempotency
    let redis_key = format!("ai:idempo:{}:{}", user_id, idempotency_key);
    ...
    check_rate_limit(deposits_state.redis.as_ref(), user_id, config.rate_limit_per_minute).await?;
    check_daily_cap(&pool, user_id, config.daily_token_cap_per_user).await?;
```

`PostAiMessageRequest.idempotency_key` required; Redis TTL 86400s on `ai:idempo:{user_id}:{key}`.

---

## E. Existing Modal / Drawer Primitives

### 1. ModalShell

**File:** `src/shared/ui/modal/ModalShell.tsx`

```6:18:src/shared/ui/modal/ModalShell.tsx
interface ModalShellProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title?: string
  description?: string
  pagePermissions?: string[]
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'content'
  variant?: 'default' | 'drawer'
  onClose?: () => void
}
```

- **Sizes:** `sm` | `md` | `lg` | `xl` | `full` | `content` (default `md`).
- **Drawer:** `variant: 'drawer'` — full-height panel, no built-in footer slot; children supply header/footer.
- **Wiring:** `useModalStore.openModal(key, component, props)` → `ModalHost` spreads `props` onto `ModalShell` (`src/shared/layout/ModalHost.tsx`).

### 2. Drawer / sheet primitive

- **Drawer:** `ModalShell` `variant: 'drawer'` only.
- **Sheet component:** **N/A — not found** under `src/`.

### 3. Streaming-friendly modal

**N/A — not found.** Closest patterns:

- `UserDetailsModal` — scrollable `scrollbar-modal`, metrics header, chat auto-scroll (`chatMessagesEndRef.scrollIntoView`).
- `AiChatTab` — streaming text with `whitespace-pre-wrap`, “Thinking…” placeholder.
- `ConfirmationModal` / `AdminConfirmModal` — static confirmations only.

Extend `ModalShell` drawer + copy chat scroll pattern for report streaming.

### 4. Toast and errors

**Confirmed:** `toast.success` / `toast.error` from `@/shared/components/common` (`ToastProvider.tsx`, exported in `index.ts`). Errors often via `getApiErrorMessage` from `@/shared/api/http`.

---

## F. Markdown Rendering

### 1. react-markdown in package.json

**N/A — not found.** No `react-markdown`, `remark`, or `rehype` in `package.json`.

### 2. Existing markdown rendering

**N/A — not found** in `src/`. AI chat renders plain text:

```454:458:src/features/terminal/components/AiChatTab.tsx
        <p className="text-sm leading-snug whitespace-pre-wrap">
          {msg.streaming && !msg.content.trim() ? (
            <span className="text-text-muted italic">Thinking…</span>
          ) : (
            msg.content
```

KYC uses PDF `<iframe>` preview (`UserKycPage.tsx`), not markdown.

### 3. Code highlight library

**N/A — not found** (no prism / highlight.js in dependencies).

**v1 implication:** Add `react-markdown` (+ optional `remark-gfm`) for report modal, or render plain `whitespace-pre-wrap` like chat.

---

## G. PDF Generation (optional future)

**N/A — not found** for generation (`jspdf`, `pdf-lib`, `@react-pdf`, etc.).

PDF only as **upload/preview** (KYC `application/pdf`, iframe preview).

---

## H. Permissions Patterns

### 1. Where new admin permissions are added

Follow AI chat migration pattern:

**File:** `backend/auth-service/migrations/20260520120000_ai_chat.sql`

```59:72:backend/auth-service/migrations/20260520120000_ai_chat.sql
INSERT INTO permissions (permission_key, label, category_id, sort_order) VALUES
  ('ai_chat:use', 'Use AI Chat', (SELECT id FROM permission_categories WHERE name = 'Configuration'), 200),
  ...
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO permission_profile_grants (profile_id, permission_key)
SELECT p.id, k
FROM permission_profiles p
CROSS JOIN (VALUES ('ai_chat:use'), ...) AS keys(k)
WHERE p.name = 'Full Access'
ON CONFLICT DO NOTHING;
```

For `ai_reports:generate`: new migration inserting into `permissions` + optional grant to “Full Access”; check in route via `permission_check::check_permission(pool, &claims, "ai_reports:generate")`.

User events example uses fixed category UUID: `backend/auth-service/migrations/20260519120000_user_events.sql`.

### 2. Bulk action permission pattern

**Separate bulk permission** (not reusing `users:edit`):

```20:28:backend/auth-service/src/routes/admin_bulk.rs
const BULK_PERMISSION: &str = "users:bulk_create";

async fn check_bulk_permission(
    pool: &PgPool,
    claims: &Claims,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role == "admin" {
        return Ok(());
    }
```

Most other actions use `permission_check::check_permission` with action-specific keys (`trading:close_position`, `deposits:approve`, etc.) — **no `users:bulk_*` besides `users:bulk_create`**.

**Recommendation:** Use `ai_reports:generate` for both single and bulk; optional `ai_reports:bulk` only if you need stricter bulk gating.

---

## I. User Selection UI Patterns

### 1. Multi-select on admin users list

**N/A — not found** (no checkbox column, no shift+click range).

### 2. Selected-users state (reference: bulk ops)

`BulkDepositSection`: `useState<Set<string>>(new Set())` — local React state, not Zustand, not URL.

```16:17:src/features/adminBulkOperations/components/BulkDepositSection.tsx
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
```

### 3. Action button positioning (bulk ops reference)

Selection count inline above table: `{selectedIds.size} of {filteredUsers.length} selected` + “Clear selection”; submit actions in form header area — **not** sticky footer/floating bar.

Symbols table uses `bulkSelect` column with `Checkbox` (`SymbolsTable.tsx`).

---

## J. Cohort Selection (future-proofing)

### 1. Groups list endpoint

- **HTTP:** `GET /api/admin/groups` — `listGroups` in `admin_groups.rs`
- **Frontend:** `listGroups({ page, page_size, search, status, ... })` — `src/features/groups/api/groups.api.ts`
- **Overview:** `GET /api/admin/groups/overview`

### 2. Tags list endpoint

- **HTTP:** `GET /api/admin/tags?search=` — `list_tags` in `admin_tags.rs`
- **Frontend:** `src/features/tags/api/tags.api.ts`

### 3. Users query with group_id / tag_id

| Filter | Supported? |
|--------|------------|
| `group_id` | **Yes** — `GET /api/auth/users?group_id=` |
| `tag_id` | **N/A — not found** on list users endpoint |
| Tag-scoped visibility | Non–`super_admin` managers see users in groups linked via `tag_assignments` (`resolve_allowed_group_ids_for_list_users` in `auth.rs`) — implicit, not a filter param |

---

## K. Anything You Notice

**Helps**

- **`build_user_context_json`** is a ready-made partial data gatherer for AI; extend it for admin reports rather than duplicating.
- **Drawer + `UserDetailsModal`** already loads summary, positions, funding, notes, chat — natural host for “Generate report”.
- **AI infra** (Anthropic streaming, NATS, ws-gateway, rate limits, idempotency) is production-shaped; mirror patterns in a new `ai_reports` route.
- **`user_events`** table and admin UI at `/admin/user-events` align with “activity” section of reports.
- **Bulk selection pattern** exists on `/admin/bulk-operations` (`Set<string>`, checkboxes) — copy for bulk reports.
- **`MultiUserMetricsModal`** on users page header shows precedent for cross-user analytics modal (separate from per-user report).

**Complicates**

- **No single admin user GET** — report backend must orchestrate multiple calls/SQL.
- **Users list KYC/risk columns are fake/TODO** — report must hit `kyc_submissions` / group risk, not list row.
- **`UserDetailsModal` orders subtabs are stubs** — report should call `list_admin_orders`, not assume UI data exists.
- **`deposit_requests` table removed** — use `transactions` only.
- **`margin_events` has no API** — needs new query or omit section.
- **Finance list lacks `userId` param** — per-user ledger needs SQL or API extension.
- **No markdown library** — add dependency for rendered reports.
- **NATS/ws today targets end-user `ai.chat.user.{user_id}`** — admin report streaming needs **new subject + ws variant + authorization** (admin must not subscribe to wrong user’s chat channel).
- **Daily cap / rate limit keys use end-user `user_id`** — decide whether caps apply to **admin** or **subject user** for reports.
- **No `ai_reports` table or `ai_reports:generate` permission yet** — greenfield migration + route.
- **List has no bulk checkboxes** — bulk report UX requires new column or bulk-ops page integration.
- **`get_admin_account_summaries_batch` runs sequentially** — bulk reports may need parallelization or server-side aggregate job.
- **Closed positions at scale:** prefer `?status=closed&limit=200` over admin global Redis `KEYS` scan.

---

*End of diagnostic.*
