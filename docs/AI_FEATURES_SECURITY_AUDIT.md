# AI Features (Chat + Reports) — Security & Correctness Audit

**Scope:** `backend/auth-service` AI services/routes, AI migrations, ws-gateway AI NATS subscribers, frontend `aiChat` / `aiReports` / `AiSettingsTab`.  
**Mode:** Read-only. **Date:** 2026-05-19.

---

# 0. Executive Summary

The AI stack is structurally sound for **user chat isolation** (one conversation per JWT subject, NATS subjects keyed by `user_id`) and **credential hygiene on read APIs** (API key never returned to clients). However, **admin report authorization replicates Auth audit F3/F10**: platform `admin` / `super_admin` roles bypass tag/group scoping on generate and can read any report by UUID. **Substantial PII and financial data** (email, balance, positions, deposits, KYC, admin activity) are serialized to JSON and sent to **Anthropic** on every chat message (when `include_user_context` is true, default) and on every report—without tiered redaction, without `trading_access` gating, and without a platform-wide spend cap.

The topic guard **fails open** when the classifier returns unparseable JSON (allows off-topic messages through). Anthropic client code has **no request timeout**, and some error paths **leak provider error bodies** to WebSocket clients. There is **no automated test coverage** for authz, rate limits, or injection paths.

**Trust score: 5/10** (harmonic mean of category scores below).

**Verdict: 🔴 No-go** for production use with real customer data until: (1) broker/tag scoping on all report endpoints for all admin-shaped roles, (2) documented subprocessor/DPA and data-minimization policy for Anthropic, (3) topic-guard fail-closed behavior, (4) platform cost ceiling.

**Top 3 issues**

1. **Critical — Admin report scope bypass (Auth F3/F10):** `post_generate` only scopes non-`admin`/`super_admin` callers; `get_report` / `list_reports` / `get_batch` skip scope checks entirely for those roles → any platform admin can generate/view reports on any user.
2. **High — External disclosure of PII/financial context:** Chat and reports send email, balances, positions, transactions, KYC, and admin audit metadata to Anthropic with no trust-tier filtering; `trading_access = disabled` does not block AI chat.
3. **High — Cost / abuse controls incomplete:** No platform-wide daily spend cap; topic guard fail-open on parse errors; daily token cap checked before async completion (TOCTOU under parallel requests); test endpoint can burn API quota without counting toward user caps.

---

# 1. Module Inventory

| Path | Lines | Purpose |
|------|------:|---------|
| `backend/auth-service/src/services/ai/mod.rs` | 12 | Module exports |
| `backend/auth-service/src/services/ai/provider.rs` | 34 | `AiProvider` trait, `AiDelta`, `AiMessage` |
| `backend/auth-service/src/services/ai/anthropic.rs` | 294 | Anthropic HTTP + SSE streaming |
| `backend/auth-service/src/services/ai/config_service.rs` | 328 | `platform_ai_config` load/update, API key resolution |
| `backend/auth-service/src/services/ai/topic_guard.rs` | 65 | Haiku classifier pre-flight |
| `backend/auth-service/src/services/ai/reports/mod.rs` | 12 | Reports submodule |
| `backend/auth-service/src/services/ai/reports/data_gatherer.rs` | 520 | Per-section SQL/Redis aggregation |
| `backend/auth-service/src/services/ai/reports/prompt_builder.rs` | 36 | System + user prompt assembly |
| `backend/auth-service/src/services/ai/reports/report_service.rs` | 507 | Report lifecycle, NATS, usage accounting |
| `backend/auth-service/src/services/open_positions_redis.rs` | 93 | Shared Redis position fetch (chat + reports) |
| `backend/auth-service/src/routes/ai_chat.rs` | 979 | User chat HTTP + background completion |
| `backend/auth-service/src/routes/ai_reports.rs` | 756 | Admin report HTTP + bulk spawn |
| `backend/auth-service/src/routes/admin_settings.rs` (AI only) | ~300 | GET/PUT `/ai`, POST `/ai/test` |
| `backend/auth-service/migrations/20260520120000_ai_chat.sql` | 73 | Chat tables + permissions |
| `backend/auth-service/migrations/20260521120000_ai_reports.sql` | 58 | Report tables + permissions |
| `infra/migrations/057_ai_reports.sql` | (dup) | Infra copy of report migration |
| `backend/ws-gateway/src/main.rs` (AI blocks) | ~85 | NATS → WS fan-out |
| `backend/ws-gateway/src/ws/protocol.rs` (AI enums) | ~10 | `ai.chat.delta`, `ai.report.delta` |
| `src/features/aiChat/api/aiChat.api.ts` | 82 | Chat REST client |
| `src/features/terminal/components/AiChatTab.tsx` | 492 | Chat UI + WS streaming |
| `src/features/aiReports/**` | ~1,466 | Reports UI, store, WS provider |
| `src/features/settings/api/aiConfig.api.ts` | 73 | Admin AI settings API |
| `src/features/settings/components/AiSettingsTab.tsx` | 900 | AI config UI |

**Duplicated logic:** `open_positions_redis::fetch_open_positions_json` shared by chat context and reports; rate limiting pattern duplicated (`check_rate_limit` vs `check_report_rate_limit`); Anthropic provider used for chat, classifier, settings test, and reports; `normalize_sections` / section constants shared between route validation and gatherer.

---

# 2. Architecture & Data Flow

## 2.1 AI Chat

```
User POST /api/ai/chat/message
  → auth_middleware (JWT → claims.sub)
  → ensure_ai_access: permission ai_chat:use, platform enabled, group ai_chat_enabled
  → rate limit (Redis INCR ai:rate:{user}:{minute})
  → daily cap (ai_usage_daily tokens, pre-check)
  → INSERT user + empty assistant rows
  → tokio::spawn run_ai_completion
       → [optional] topic_guard::is_on_topic (Haiku, non-stream)
       → build_user_context_json (if include_user_context)
       → build_system_prompt (inject JSON context)
       → load last 20 messages for conversation
       → Anthropic stream_chat
       → NATS publish ai.chat.user.{user_id} (delta|message|done|error)
       → UPDATE ai_messages, ai_usage_daily
  → ws-gateway: subscribe ai.chat.> → get_user_connections(user_id) → AiChatDelta
  → AiChatTab (terminal)
```

## 2.2 AI Report (single)

```
Admin POST /api/admin/ai/reports
  → permission ai_reports:generate (or bulk_generate if N>1 users)
  → resolve_allowed_group_ids + ensure_user_in_allowed_groups per subject
     (SKIPPED when role admin/super_admin → allowed_group_ids = None)
  → report rate limit + daily cap (count = len(subject_ids))
  → insert_pending_report per user
  → tokio::spawn run_report_generation (or bulk pool)
       → gather_report_data (SQL/Redis per section)
       → build_report_prompt (JSON + optional focus_prompt)
       → Anthropic stream_chat
       → NATS ai.report.admin.{admin_user_id}
       → persist content, increment ai_report_usage_daily on success only
  → ws-gateway: ai.report.> → get_user_connections(admin_id) [no role re-check — F6]
  → Admin UI drawers
```

## 2.3 AI Report (bulk)

Same as single, with `bulk_batch_id`, `permission ai_reports:bulk_generate`, max users from config, and:

```483:525:backend/auth-service/src/routes/ai_reports.rs
        stream::iter(pairs)
            .for_each_concurrent(concurrency, |(subject_id, report_id)| {
                // ... run_report_generation per pair
            })
            .await;
```

`concurrency = report_bulk_concurrency.max(1)` (default 3). No cancellation API; in-flight tasks run to completion after HTTP 202.

## 2.4 Permission table

| Endpoint | Permission / gate | Scoping | Rate limit | Daily cap |
|----------|-------------------|---------|------------|-----------|
| `GET /api/ai/chat/conversation` | `ai_chat:use`, global + group enabled | Own user only (`claims.sub`) | — | — |
| `POST /api/ai/chat/message` | same | Own user | Redis `ai:rate:{user}:{min}` INCR+EXPIRE 70s | `ai_usage_daily` tokens (pre-check) |
| `DELETE /api/ai/chat/conversation` | same | Own user | — | — |
| `GET /api/ai/chat/usage` | same | Own user | — | — |
| `POST /api/admin/ai/reports` | `ai_reports:generate` or `:bulk_generate` | **Tag scope only for non-admin roles** | `ai:report:rate:{admin}:{min}` | `ai_report_usage_daily.reports_generated` (pre-check += batch size) |
| `GET /api/admin/ai/reports/:id` | `ai_reports:view` | **None for admin/super_admin** | — | — |
| `GET /api/admin/ai/reports` | `ai_reports:view` | List filtered by allowed groups **or unfiltered for admin** | — | — |
| `GET /api/admin/ai/reports/batch/:id` | `ai_reports:view` | Per-row check for scoped roles only | — | — |
| `DELETE /api/admin/ai/reports/:id` | `ai_reports:delete` | Scoped roles only; admin bypass | — | — |
| `GET /api/admin/settings/ai` | `ai_settings:view` via `check_settings_permission` (**admin role bypass**) | Platform | — | — |
| `PUT /api/admin/settings/ai` | `ai_settings:edit` (admin bypass) | Platform | — | — |
| `POST /api/admin/settings/ai/test` | `ai_settings:edit` (admin bypass) | Platform | **None** | **None** |

## 2.5 Data leaving the platform (Anthropic)

**User chat** (when `include_user_context`, default `true`):

- Profile: first/last name, **email**, group name, KYC status, `trading_access`
- `account_summary`: balance, equity, margin_used, free_margin, margin_level, realized/unrealized PnL (from Redis `account_summary` — same finance surface as terminal)
- Up to 10 open positions (symbol, side, size, entry, margin, leverage, PnL fields from Redis hashes)
- Last 5 orders (symbol, side, type, status, size, timestamp)
- Full chat history (up to 20 prior messages) + new user message

**AI reports** (admin-initiated; entire `ReportData` JSON pretty-printed):

- **profile:** user id, email, phone, country, role, status, group, leverage caps, referral fields, KYC, timestamps, `permission_profile_id`
- **trading_performance / closed_trades / open_positions:** aggregates and position details
- **financial_activity:** transaction sums by type/status, net flow
- **risk_profile:** margin events, leverage caps
- **kyc:** submission history, rejection reasons
- **engagement:** 90-day `user_events` histogram
- **affiliate:** referrer email/id, referral counts, commissions
- **admin_activity:** admin/finance `user_events` with **`actor_user_id`** and full `meta` JSON
- **focus_prompt:** admin free text appended to user prompt

**Admin settings test:** arbitrary admin message to Anthropic (512 max tokens); no user PII unless admin types it.

---

# 3. Findings — DETAILED

## 3.1 Credential handling

| Item | Result |
|------|--------|
| Storage | `platform_ai_config.api_key` **plaintext** `TEXT` (by design, same as Voiso). |
| GET exposure | **Safe.** `ai_config_to_json` returns `apiKeyConfigured` booleans only, never the key. |
| Outbound use | `AiConfigService::resolve_api_key`: DB first, then `ANTHROPIC_API_KEY` env. |
| Logging | No intentional key logging in AI modules. Classifier warns with `classifier_response = %raw` (model output, not key). Anthropic errors log `status` + body in `warn!` / `error!` — body could theoretically echo headers; not observed in code paths that log the request. |
| Client error leakage | `post_test_ai_config` returns `"error": e.to_string()` which may include Anthropic HTTP body (not the key, but operational detail). `db_err` in chat/reports returns `e.to_string()` for SQL errors. |
| Test endpoint auth | `check_settings_permission` → **`admin` / `super_admin` bypass** permission profile; others need `ai_settings:edit` in profile. |
| Test endpoint caps | **Does not** increment `ai_usage_daily` or report caps — unbounded quota burn by any settings editor. |

```247:280:backend/auth-service/src/routes/admin_settings.rs
fn ai_config_to_json(config: &PlatformAiConfig) -> serde_json::Value {
    // ...
    serde_json::json!({
        "provider": config.provider,
        "model": config.model,
        "apiKeyConfigured": stored_api_key_configured || env_api_key_configured,
        // no api_key field
```

**Finding AI-C01 (Medium):** Plaintext API key at rest; mitigate with KMS/secret manager rotation.  
**Finding AI-C02 (Low):** Test endpoint and DB error responses can leak Anthropic/Postgres diagnostic strings to admins.

---

## 3.2 Topic guard correctness

**Classifier implementation:**

```19:44:backend/auth-service/src/services/ai/topic_guard.rs
pub async fn is_on_topic(
    api_key: &str,
    classifier_model: &str,
    user_message: &str,
) -> anyhow::Result<bool> {
    let provider = AnthropicProvider::new(api_key.to_string(), classifier_model.to_string());
    let raw = provider
        .complete(CLASSIFIER_SYSTEM, user_message, CLASSIFIER_MAX_TOKENS)
        .await?;
    // ...
    match serde_json::from_str::<ClassifierResponse>(json_str) {
        Ok(parsed) => Ok(parsed.relevant),
        Err(e) => {
            warn!(classifier_response = %raw, error = %e, "Topic classifier returned unparseable JSON; allowing message");
            Ok(true)  // FAIL OPEN
        }
    }
}
```

| Item | Result |
|------|--------|
| Model / tokens | Default `classifier_model` = `claude-haiku-4-5`; `CLASSIFIER_MAX_TOKENS = 20`. |
| User message in classifier | Passed as **user** turn only; injection could bias classifier but impact is **off-topic allowance** (Low). |
| API error | In `run_ai_completion`, `Err(_)` from `is_on_topic` → treated like off-topic → **blocks** message (fail closed for availability). |
| Unparseable JSON | **`Ok(true)` — fail open** (Finding AI-T01, Medium). |
| System prompt strength | Default chat prompt forbids off-topic and revealing instructions; not a robust jailbreak defense. |

---

## 3.3 User context in AI chat

**`build_user_context_json`:**

```238:330:backend/auth-service/src/routes/ai_chat.rs
async fn build_user_context_json(
    pool: &PgPool,
    redis: &crate::redis_pool::RedisPool,
    user_id: Uuid,
) -> serde_json::Value {
    // profile: first_name, last_name, email, trading_access, group_name, kyc_status
    // account_summary via get_account_summary_for_user
    // open_positions via open_positions_redis (cap 10)
    // recent_orders LIMIT 5
    serde_json::json!({
        "profile": { ... },
        "accountSummary": account_summary,
        "openPositions": open_positions,
        "recentOrders": recent_orders_json,
    })
}
```

| Item | Result |
|------|--------|
| password_hash / refresh_token | **Not included** (explicit column list for profile). |
| Other users' data | All queries bind `$1 = user_id` — **no cross-user leakage** in gather path. |
| Low trust / no KYC | **No withholding** — same context either way. |
| `trading_access = disabled` | **Not checked** in `ensure_ai_access` — disabled traders can still use AI if permitted (Finding AI-D01, High). |
| Toggle | `include_user_context` platform flag skips context (empty `{}`). |

---

## 3.4 AI report data gathering

**`gather_report_data`:**

```57:107:backend/auth-service/src/services/ai/reports/data_gatherer.rs
pub async fn gather_report_data(...) -> Result<ReportData> {
    for section in &sections {
        let value = match section.as_str() { ... };
        match value {
            Ok(v) => set_section(...),
            Err(e) => {
                warn!(...);
                set_section(..., Some(empty_section()));  // partial report
            }
        }
    }
    Ok(data)
}
```

| Section | SQL binding | Cross-user risk |
|---------|-------------|-----------------|
| All fetchers | `.bind(user_id)` / `subject_user_id` | **Low** — consistent `WHERE user_id = $1` |
| closed_trades | `positions WHERE user_id = $1 AND status = 'closed'` | Correct aggregation |
| admin_activity | `user_events WHERE subject_user_id = $1` + `actor_user_id` in output | **Intended** for internal admin review; leaks which admin acted (Finding AI-D02, Low/Info) |
| engagement | 90-day `user_events` GROUP BY | Possible **slow query** on large tables (Finding AI-D03, Low perf) |
| profile | `SELECT * FROM users` then **manual JSON** — secrets not serialized | Safe |

**Partial failure:** Section errors → empty `{}` for that section; report still sent to Anthropic — model may hallucinate gaps.

---

## 3.5 Prompt injection vectors

| Vector | Assessment |
|--------|------------|
| Chat user message | Direct model input; standard injection risk; system prompt only (Finding AI-P01, Medium). |
| Report `focus_prompt` | Admin-controlled; appended to user prompt — insider risk (Low). |
| DB-sourced names in JSON | `firstName` / `email` embedded in JSON without escaping; model could be manipulated (Finding AI-P02, Low). |
| Report system prompt | Says "Do NOT include PII beyond input" but input **contains** PII — contradictory (Finding AI-P03, Low). |

No server-side sanitization of user profile fields before external API call.

---

## 3.6 Authorization

### User AI chat — **Strong**

- All routes use `claims.sub` for conversation/messages; **no** `conversation_id` path parameter → **no IDOR**.
- `get_or_create_conversation` keyed by `user_id` with unique index `uq_ai_conv_user_single`.

### Admin AI reports — **Weak for platform admins**

**Generate — scoped for managers, bypass for admin role:**

```358:368:backend/auth-service/src/routes/ai_reports.rs
    let allowed_group_ids = if claims.role == "admin" || claims.role == "super_admin" {
        None
    } else {
        resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?
    };
    for uid in &subject_ids {
        ensure_user_in_allowed_groups(&pool, allowed_group_ids.as_deref(), *uid)
```

When `allowed_group_ids` is `None`, `ensure_user_in_allowed_groups` **returns Ok immediately** (full platform access) — **Auth F3 confirmed for admin-shaped roles.**

**View by ID — IDOR across broker tags:**

```565:570:backend/auth-service/src/routes/ai_reports.rs
    if claims.role != "admin" && claims.role != "super_admin" {
        let allowed = resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?;
        ensure_user_in_allowed_groups(&pool, allowed.as_deref(), row.subject_user_id)
```

Any `admin` / `super_admin` with `ai_reports:view` can `GET /api/admin/ai/reports/{uuid}` for **any** user's report.

**Finding AI-A01 (Critical):** Tag-scoped managers are protected on generate/list; **platform admin role is not**. Same pattern as Auth F10 (permission bypass for `admin` role on settings).

**Finding AI-A02 (High):** Report IDOR for unscoped admins — horizontal privilege across broker territories.

**Note:** Pre-audit prediction "NO ensure_user_in_allowed_groups" is **incorrect for managers** — the call exists but is **neutralized** for `admin`/`super_admin`.

---

## 3.7 Rate limiting and quotas

| Mechanism | Implementation | Issues |
|-----------|----------------|--------|
| Chat per-minute | Redis `INCR` + `EXPIRE 70` on first hit | Correct sliding minute bucket; not SET NX but equivalent. |
| Chat daily tokens | `SELECT` sum before spawn; `INSERT ... ON CONFLICT` after completion | **TOCTOU:** parallel posts can exceed cap (Finding AI-R01, Medium). |
| Report per-minute | Same INCR pattern | OK |
| Report daily | Pre-check `used + len(subjects) > cap`; increment **only on successful completion** | Failed reports don't count; batch pre-check is conservative. |
| max_tokens | Server-side `config.max_tokens_per_message` / `report_max_tokens` | Enforced in Anthropic request body. |
| Platform-wide cap | **None** | Finding AI-R02 (High). |

Rate limit applies on accepted `POST` before background work — retries with new idempotency key count again; same key returns cached 202 without incrementing (idempotency returns early **before** rate limit on duplicate — actually idempotency is checked **before** rate limit, so replay is free).

```517:539:backend/auth-service/src/routes/ai_chat.rs
    if let Ok(Some(cached)) = conn.get(...idempo...).await { return Ok(ACCEPTED ...); }
    check_rate_limit(...).await?;
    check_daily_cap(...).await?;
```

**Finding AI-R03 (Low):** Idempotent replay bypasses rate limit (by design).

---

## 3.8 Streaming and cross-user leakage

| Channel | Isolation | Issue |
|---------|-----------|-------|
| `ai.chat.user.{user_id}` | ws-gateway routes to `get_user_connections(user_id)` | **OK** for chat |
| `ai.report.admin.{admin_id}` | Routes to connections registered under `admin_id` | Regular users **cannot** receive another admin's stream unless JWT `sub` matches (stolen admin token). |
| ws-gateway F6 | **Still open** — no `role` check at delivery | Mis-publish to wrong admin id delivers to that admin's sessions; no defense-in-depth. |

```277:296:backend/ws-gateway/src/main.rs
                let admin_id = match subject.strip_prefix("ai.report.admin.") {
                    Some(id) if !id.is_empty() => id.to_string(),
                    _ => continue,
                };
                let conn_ids = registry_reports.get_user_connections(&admin_id);
                // no role filter
```

**Finding AI-S01 (Medium):** ws-gateway F6 — add admin/manager role filter on `ai.report.delta` fan-out.

Chat error events include `"detail": msg` with Anthropic error string — only sent on user's own NATS subject (Finding AI-S02, Low).

---

## 3.9 Storage and retention

| Table | Retention | User delete |
|-------|-----------|-------------|
| `ai_conversations` / `ai_messages` | **Indefinite** | `ON DELETE CASCADE` from `users` |
| `ai_usage_daily` | Indefinite | **No FK** to `users` — orphan rows possible |
| `ai_reports` | Indefinite | `subject_user_id ON DELETE CASCADE`; `generated_by SET NULL` |

**Finding AI-K01 (Medium):** No TTL/archival for chat/report content — GDPR erasure deletes via CASCADE but no explicit purge job; usage_daily orphans.

`DELETE` conversation clears messages but **retains** conversation row.

---

## 3.10 Bulk report safety

| Item | Result |
|------|--------|
| Concurrency | `for_each_concurrent(report_bulk_concurrency)` default 3 |
| Partial failure | One failure does not stop others (`let _ = run_report_generation`) |
| Cancel | **Not implemented** |
| Memory | Each task buffers full report in `String` — 20 × large markdown bounded by `report_max_tokens` config |
| Daily cap | Pre-check adds `subject_ids.len()` once per batch request |

---

## 3.11 Anthropic API client safety

```24:30:backend/auth-service/src/services/ai/anthropic.rs
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: reqwest::Client::new(),  // default TLS, no danger_accept_invalid_certs
            api_key,
            model,
        }
    }
```

| Item | Result |
|------|--------|
| TLS | reqwest/rustls defaults — **OK** |
| Timeout | **None** configured — hung streams block task (Finding AI-N01, Medium) |
| Retries | **None** — no double-count risk |
| Malformed SSE | Skips unparseable lines (`debug!`); no panic |
| Empty stream | Emits `AiDelta::Error` if stop without text |

---

## 3.12 Audit trail

| Event | Location | Content |
|-------|----------|---------|
| `ai.message.completed` | `ai_chat.rs` | `preview` (80 chars), token counts, status — **not full message** |
| `ai.message.blocked` | `ai_chat.rs` | `reason`, `preview` |
| `ai.report.generated` | `report_service.rs` | reportId, tokens — not section list |
| `ai.report.failed` | `report_service.rs` | error message |
| `ai.report.bulk_started` | `ai_reports.rs` | batch id, user count |
| `ai.report.deleted` | `ai_reports.rs` | reportId |

**Compliance:** Full Q&A recoverable from `ai_messages` / `ai_reports.content` DB tables, not from `user_events` alone.

---

## 3.13 Information disclosure in errors

| Path | Leakage |
|------|---------|
| `db_err` | Postgres `e.to_string()` to client |
| NATS `error` event | `detail` = raw Anthropic message to WS |
| Test AI | `e.to_string()` in JSON |

---

## 3.14 Frontend safety

| Item | Result |
|------|--------|
| API key in bundle | **No** — only `apiKeyConfigured` flags (`aiConfig.api.ts`) |
| AiSettingsTab | Password input for key; not persisted in localStorage |
| Chat rendering | Plain text in `AiChatTab` — **no** markdown / `dangerouslySetInnerHTML` |
| Report rendering | `react-markdown` + `remark-gfm` only; **no** `rehype-raw` |
| Links in reports | `<a target="_blank" rel="noopener noreferrer">` — javascript: URLs still a minor concern |

---

## 3.15 Test coverage

| Area | Tests found |
|------|-------------|
| topic_guard `extract_json_object` | 1 unit test |
| prompt_builder, rate limit, authz, E2E | **None** |

---

## 3.16 Cost runaway

| Control | Limit |
|---------|-------|
| Per-user daily tokens | Default 50,000 |
| Per-admin daily reports | Default 50 |
| Bulk size | Default 20 users |
| Platform daily $ cap | **Missing** |
| Test endpoint | **Unmetered** |

**Scenario:** 10 admins × 50 reports × 4096 tokens ≈ high Anthropic bill with no global stop (Finding AI-R02).

---

# 4. Strengths

1. **Chat tenancy model** — Single conversation per user, all DB access via `claims.sub`, NATS subject includes user id, ws-gateway fans out only to matching connections.
2. **API key never returned** on GET settings; separate flags for stored vs env key.
3. **Parameterized SQL** throughout data gatherer and chat routes.
4. **Server-enforced** `max_tokens`, message length 4000, idempotency keys with Redis TTL.
5. **Report generate** calls `ensure_user_in_allowed_groups` for scoped (manager) callers.
6. **Bulk concurrency** bounded; partial section failures don't abort entire gather.
7. **Frontend** does not embed secrets; report markdown avoids raw HTML pipeline.
8. **CASCADE** on user delete for conversations and reports.
9. **Topic guard** on classifier API failure blocks rather than allows (except parse fail-open path).

---

# 5. Trust Score Breakdown

| Category | Score | Notes |
|----------|------:|-------|
| Credential handling | 6/10 | No GET leak; plaintext at rest; test/diagnostic leakage |
| Topic guard effectiveness | 4/10 | Fail-open on bad JSON; bypass = annoyance not data leak |
| Authorization (chat) | 8/10 | Solid own-user model |
| Authorization (reports) | 4/10 | Admin bypass + IDOR |
| Cross-user leakage resistance | 7/10 | NATS isolation good; F6 depth |
| Rate limiting / cost control | 5/10 | Caps exist; TOCTOU, no platform cap, unmetered test |
| Prompt injection resistance | 4/10 | Standard unresolved LLM risks |
| Data retention compliance | 3/10 | Forever storage, minimal erasure story |
| Audit trail | 6/10 | DB has content; events are metadata-only |
| Error/panic safety | 6/10 | No panics; timeouts missing |

**Harmonic mean ≈ 5.0/10**

---

# 6. Production Go-Live Verdict

## 🔴 No-go

Ship only after addressing **AI-A01/A02** (admin scoping), **AI-D01** (policy for external LLM + disabled traders), **AI-T01** (topic guard fail-closed), and **AI-R02** (platform cost ceiling). ws-gateway **F6** should ship as defense-in-depth.

---

# 7. Prioritized Fix List

| # | Finding | Severity | Effort | Sprint |
|---|---------|----------|--------|--------|
| 1 | AI-A01/A02: Apply `resolve_allowed_group_ids` + scope checks for **all** roles including `admin` with manager tags; filter `get_report`/`list` by allowed groups | Critical | M | 1 |
| 2 | AI-D01: Document Anthropic DPA; add `trading_access` + KYC tier gates before sending context; default `include_user_context` review | High | M | 1 |
| 3 | AI-R02: Platform-wide daily token/spend cap in Redis; meter test endpoint | High | S | 1 |
| 4 | AI-T01: Topic guard unparseable JSON → `Ok(false)` or retry | Medium | S | 1 |
| 5 | AI-S01: ws-gateway role check on `ai.report.delta` (F6) | Medium | S | 1 |
| 6 | AI-N01: reqwest timeout + stream idle timeout | Medium | S | 2 |
| 7 | AI-R01: Reserve daily tokens in Redis before spawn (INCRBY with rollback) | Medium | M | 2 |
| 8 | AI-C01: Encrypt API key at rest or use secret manager | Medium | L | 2 |
| 9 | AI-K01: Retention job + FK on `ai_usage_daily` | Medium | M | 2 |
| 10 | AI-S02/C02: Strip `detail` from client errors; generic DB errors | Low | S | 2 |
| 11 | Tests: authz matrix, rate cap, topic guard, gatherer SQL | Medium | L | 2 |

---

# 8. Cross-Module Notes

| Module | Implication |
|--------|-------------|
| **Auth service (F3, F10)** | AI reports reproduce tag bypass for `admin`/`super_admin` and settings permission bypass for AI config endpoints. |
| **Finance** | `get_account_summary_for_user` feeds Anthropic; dual-balance issues in finance audit affect accuracy of AI advice, not leakage. |
| **ws-gateway (F6)** | Report streams lack role gate; chat routing is sound. |
| **Order engine / Redis** | Open positions and account summary trust Redis contents — compromised Redis → wrong AI context. |
| **Frontend** | Terminal chat relies on WS + delayed REST sync (`scheduleAssistantSync` timeouts) — not polling for live tokens (OK per no-polling rule); ensure WS auth cannot register wrong user id. |
| **Compliance** | Treat Anthropic as **subprocessor**; customer-facing privacy policy must disclose AI processing of trading/PII data. |

---

*End of audit.*
