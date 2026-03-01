# Plan: Liquidation email to user (same as SL/TP)

| Field | Value |
|-------|--------|
| **Status** | Implemented — pending your approval of current behavior |
| **Scope** | Auth-service only; one HTML email to the **user** (trader) per liquidation event. |
| **Implementation** | **Already in code.** Approval = confirm behavior or request content/config changes; no new feature build required. |

---

## 1. Objective

When a liquidation notification is generated, the system must send an **email to the user** (the trader whose position was liquidated), using the **same pattern** as Stop Loss and Take Profit: HTML body, admin-configured SMTP, fire-and-forget, one email per event.

**Current state:** This is already implemented. This document describes the behavior and verifies the code path so you can approve with confidence.

---

## 2. Verification (chain traced for 100% correctness)

The following was verified against the codebase:

| Step | Verified in code |
|------|-------------------|
| **1. Trigger** | `main.rs`: on `event.position.closed` with `trigger_reason == "liquidated"`, auth-service spawns `create_liquidation_notifications_and_push(pool, redis, inner)`. |
| **2. Payload** | `inner` contains `user_id`, `position_id`, `symbol`, `side`, `realized_pnl`, `exit_price` (same as SL/TP from order-engine `PositionClosedEvent`). |
| **3. User email lookup** | `deposits.rs` ~1464–1471: `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL`; result trimmed and checked non-empty. |
| **4. SMTP config** | Same file ~1475: `EmailConfigService::new(pool).get_with_password().await` — same as SL/TP; uses Admin → Settings → Email. If no config or default placeholder, email is skipped (no crash). |
| **5. HTML body** | `build_liquidation_email_html(&symbol, &side, &realized_pnl_display, &exit_price_display)` (~1002–1046): red header, table (symbol, side, PnL, exit price), footer. Uses same `escape_html` and formatting helpers as SL/TP. |
| **6. Send** | `send_email_html_sync(&config, &to_email, &subject, &html_body)` inside `tokio::spawn` + `spawn_blocking` (~1483–1493). Subject = `title` = `"Position liquidated"`. Same function and pattern as SL/TP (~1222–1195). |
| **7. Single path** | Liquidation email is sent only from `create_liquidation_notifications_and_push`. The old path in `position_event_handler` (plain-text email) was removed, so the user receives **exactly one email** per liquidation. |

**Conclusion:** The flow is complete and matches SL/TP. No missing steps; no duplicate sends.

---

## 3. Where it lives

| What | File and location |
|------|--------------------|
| **HTML builder** | `backend/auth-service/src/routes/deposits.rs` — `build_liquidation_email_html` (~lines 1002–1046). |
| **Send logic** | Same file — inside `create_liquidation_notifications_and_push`, block “Send HTML email to user (fire-and-forget)” (~lines 1463–1496). |
| **Imports** | Same file — `send_email_html_sync`, `EmailConfigService` (line 33); same as SL/TP. |

---

## 4. Parity with SL/TP email

| Aspect | SL/TP | Liquidation |
|--------|--------|-------------|
| Recipient | User (trader) only | User (trader) only |
| When | After notification created and pushed | After notification created and pushed |
| SMTP | EmailConfigService (Admin → Settings → Email) | Same |
| Format | HTML via `send_email_html_sync` | Same |
| Fire-and-forget | `tokio::spawn` + `spawn_blocking` | Same |
| Subject | “Stop Loss triggered” / “Take Profit triggered” | “Position liquidated” |
| Content | Symbol, side, realized PnL, exit price | Symbol, side, realized PnL, exit price |
| Style | Red (SL) or green (TP) header | Red/danger header (#b91c1c) |

Admins do not receive email for SL/TP or liquidation; they get in-app notifications only. Behavior is consistent.

---

## 5. Email content (liquidation)

- **Subject:** `Position liquidated`
- **Body (HTML):**
  - Red header: “Position Liquidated”
  - Line: “Your position was closed automatically due to liquidation (margin level fell below the required level).”
  - Table: Symbol, Side, Realized PnL (color by sign), Exit price
  - Footer: “This is an automated notification from your trading account.”

Layout and styling match the SL/TP HTML emails (font, table, footer).

---

## 6. Conditions for sending

- User has a non-empty `email` in `users` and is not soft-deleted.
- SMTP is configured (Admin → Settings → Email) and not the default placeholder.
- Email is sent only from this path → **one email per liquidation** per user.

---

## 7. Assumptions

- Order-engine continues to publish `event.position.closed` with `trigger_reason: "liquidated"` and the same payload shape.
- Admin SMTP config (if set) is valid; failures are logged and do not block notifications or the rest of the flow.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| SMTP slow or down | Send is fire-and-forget; errors logged. Notification and Redis push are not blocked. |
| User has no email | Query returns empty; email block is skipped; notification still created and pushed. |
| Duplicate email | Only one code path sends liquidation email; dedupe in notification creation (2-min window) reduces duplicate events. |

---

## 9. Summary

- **Liquidation email to the user is implemented** and follows the same pattern as SL/TP (HTML, SMTP config, fire-and-forget).
- Code path is traced and verified; behavior is consistent and single-path.
- **Approval:** If this behavior is what you want, no implementation work is required. If you want changes (e.g. subject line, wording, or optional admin email), say what to change and we can update the implementation and this doc.

---

*Approval: _____________  Date: _____________*
