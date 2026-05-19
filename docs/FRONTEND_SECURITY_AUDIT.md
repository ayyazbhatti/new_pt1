# Frontend (React SPA) — Security & Correctness Audit

**Scope:** `src/`, `package.json`, `package-lock.json`, `vite.config.ts`, `index.html`, `public/`, `deploy/` nginx frontend config.  
**Mode:** Read-only. **Date:** 2026-05-19.

---

# 0. Executive Summary

The NEWPT frontend is a React 18 + Vite SPA using **Bearer JWT in `Authorization` headers** (no auth cookies), with tokens persisted via **Zustand `persist` → `localStorage`** (`auth-storage`). There is **no `dangerouslySetInnerHTML`** and only one **react-markdown** surface (AI reports), configured without `rehype-raw`. Admin route guards use **API-sourced permission lists** (not role-only bypass for page access, except `super_admin`).

Critical issues: **impersonation passes access and refresh tokens in the URL hash** (history, Referer, shoulder-surfing); **partial JWT prefix logged to console** on WebSocket auth (ws-gateway F11 alignment); **protocol-relative open redirect** on impersonate `redirect` param (`//evil.com`). High issues: **tokens in localStorage** (XSS = full account takeover); **verbose production `console.log`** in WebSocket paths; **admin finance UI reacts to all `deposit.request.*` WS events** without user filter (amplifies ws-gateway broadcast bug). No Anthropic or MMDPS API keys in the client bundle.

**Trust score: 5/10** (harmonic mean).

**Verdict: 🟡 Conditional no-go** — ship only after fixing impersonation token transport and tightening logging; accept localStorage risk with strong CSP + XSS discipline.

**Top 3 issues**

1. **Critical — Impersonation JWTs in URL hash** (`/impersonate#access_token=...&refresh_token=...`).
2. **High — Access/refresh tokens in `localStorage`** via Zustand persist (standard but XSS-critical).
3. **High — WebSocket client logs first 20 characters of JWT**; `useWebSocket` hook has extensive debug logging suitable only for dev.

---

# 1. Module Inventory

## Top-level `src/` structure

| Area | Path | Role |
|------|------|------|
| App shell | `src/app/` | Router, layouts, providers, modal store |
| Features | `src/features/*` | Domain UI (terminal, admin*, wallet, kyc, ai*, settings, …) |
| Shared | `src/shared/` | HTTP client, auth store, WS client, guards, UI kit |
| Pages | `src/pages/auth/` | Login, register, impersonate |
| Types | `src/types/` | Shared TS types |

~659 files under `src/`. Feature folders follow `api/`, `components/`, `hooks/`, `pages/` conventions.

## Concerning patterns (by area)

- **Auth / impersonation:** URL hash token handoff, no “you are impersonating” banner.
- **WebSocket:** Heavy `console.log`, legacy `localStorage.getItem('token')` fallback, global event subscribers.
- **Admin finance:** WS handlers trust broadcast deposit events (backend issue, UI amplifies).
- **Third-party embed:** Voiso `iframe` without `sandbox`.
- **KYC:** PDF via `<embed>` + blob URLs (not iframe sandbox issue, but large client-side blobs).

## Files of highest concern

| File | Why |
|------|-----|
| `src/shared/store/auth.store.ts` | Persists `accessToken` + `refreshToken` to localStorage |
| `src/features/adminUsers/components/UsersTable.tsx` | Builds impersonation URL with tokens in hash |
| `src/pages/auth/ImpersonatePage.tsx` | Reads tokens from hash; weak redirect validation |
| `src/shared/ws/wsClient.ts` | Logs JWT prefix; fans in all WS events app-wide |
| `src/shared/hooks/useWebSocket.ts` | Alternate WS stack with verbose logging + legacy token fallback |

---

# 2. Architecture Overview

## Auth token storage

```
Login API → auth.store.login() → set({ accessToken, refreshToken, user })
         → zustand persist → localStorage key "auth-storage"
```

- **Access + refresh tokens:** `localStorage` via `persist` (`name: 'auth-storage'`), partialized fields include both tokens and user object.

```307:314:src/shared/store/auth.store.ts
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
```

- **Cookies:** Not used for authentication (`document.cookie` only in affiliate “cookie days” labels).
- **Legacy keys:** `logout()` clears `localStorage`/`sessionStorage` key `token`; WS code still falls back to them.

## Token attachment to HTTP

`src/shared/api/http.ts` — native `fetch`, not axios:

- Adds `Authorization: Bearer ${accessToken}` when present.
- On **401**, single shared `refreshPromise` → `POST /api/auth/refresh` → `setTokens` → retry.
- Refresh failure calls `logout()` (clears store; does not clear React Query cache globally).

## Refresh flow

- **Reactive:** 401 → refresh once → retry.
- **Proactive:** `scheduleProactiveAccessTokenRefresh()` timer from JWT `exp` minus buffer (`EXPIRY_BUFFER_SEC`).
- **`ensureValidAccessToken()`:** Used before WS auth; refreshes if near expiry.

No polling loop for session (aligned with platform rules).

## Routing guards (UI-only; backend must enforce)

| Guard | Behavior |
|-------|----------|
| `AuthGuard` | Waits `persistRehydrated` + `hydrateFromStorage`; redirects unauthenticated to `/login` with `state.from` preserved (login page does **not** currently consume `from` for redirect). |
| `AdminGuard` | Requires role ∈ `{admin, super_admin, manager, agent}` — **role-based**, not permission keys. |
| `AdminRouteGuard` | Maps pathname → permission via `ADMIN_ROUTE_PERMISSIONS`; uses `canAccess()` from API `user.permissions`. **`super_admin` bypasses all.** Admin/manager need profile grants (improvement vs backend `permission_check` admin bypass). |
| `UserGuard` | Keeps admin-panel roles off `/user/*`. |

Frontend checks are **UX only**; comments and structure assume API rejection.

## Build / `VITE_*` variables

Referenced in source:

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | API base (empty = same-origin) |
| `VITE_WS_URL` | Override WS gateway URL |
| `VITE_DATA_PROVIDER_WS_URL` | Raw price WS (logged-out / dev) |
| `VITE_DATA_PROVIDER_HTTP_URL` | Chart/history HTTP |
| `VITE_DATA_PROVIDER_HTTP_PATH` | Same-origin path (prod Docker: `/dp`) |
| `VITE_MMDPS_SYMBOLS` | Chart routing override |
| `VITE_VOISO_PANEL_URL` | Voiso iframe URL (public workspace URL, not a secret) |

**Not found in frontend source:** `ANTHROPIC_API_KEY`, JWT secrets, DB URLs, admin API keys (AI/Voiso/MMDPS keys are `*Configured` flags from API only).

Production `deploy/Dockerfile.frontend` sets `VITE_API_URL=` and `VITE_DATA_PROVIDER_HTTP_PATH=/dp` at build time.

## WebSocket URL

```344:348:src/shared/ws/wsClient.ts
const WS_URL =
  import.meta.env?.VITE_WS_URL ||
  (typeof location !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?group=default`
```

Production behind HTTPS → **`wss://` same host** via nginx `/ws` proxy.

---

# 3. Findings — DETAILED

## 3.1 Authentication token storage

| Check | Result |
|-------|--------|
| Access token location | Zustand → **`localStorage`** (`auth-storage`) |
| Refresh token | Same — **long-lived secret in localStorage** |
| HttpOnly cookies | **No** |
| Impersonation | **New tab** opens `/impersonate#access_token=...&refresh_token=...`; **replaces** session in that tab only (`setImpersonationTokens`); admin’s original tab keeps admin JWT |
| Admin JWT preserved | Yes — separate tab; no dual-token store |
| Token in URL | **Yes — Critical** (see FE-A01) |

**FE-A01 (Critical) — Impersonation tokens in URL hash**

```224:231:src/features/adminUsers/components/UsersTable.tsx
      const { access_token, refresh_token } = await impersonateUser(user.id)
      const params = new URLSearchParams({
        access_token: access_token,
        refresh_token: refresh_token,
        redirect: '/',
      })
      const url = `${window.location.origin}/impersonate#${params.toString()}`
      window.open(url, '_blank', 'noopener,noreferrer')
```

Impact: tokens appear in browser history, sync/debug tools, crash reports, and possibly **Referer** if the SPA navigates to third-party HTTP resources before hash is cleared. Violates OWASP guidance to never pass tokens in URLs.

**FE-A02 (High) — JWT pair in localStorage**

Industry-common for SPAs but **any XSS** exfiltrates `auth-storage` JSON including `refreshToken`. Mitigate with CSP, strict markdown, short refresh TTL, refresh rotation (backend).

**FE-A03 (Low) — Legacy `token` key fallback**

`useWebSocket.ts` and `logout()` reference `localStorage.getItem('token')` — stale parallel storage path.

---

## 3.2 XSS attack surfaces

### `dangerouslySetInnerHTML`

**Grep: zero matches** in `src/`.

### Markdown

Only `src/features/aiReports/components/ReportMarkdown.tsx`:

```89:91:src/features/aiReports/components/ReportMarkdown.tsx
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
```

- **No `rehype-raw`** — HTML in model output is escaped, not executed.
- Links render with `target="_blank"` and `rel="noopener noreferrer"` — `javascript:` URLs in `href` remain a **low** risk if markdown ever allowed raw URLs without sanitization (react-markdown default is cautious).

**Malicious payload example (AI report):**  
Input: `![x](javascript:alert(1))` or `<img onerror=alert(1) src=x>`  
**Result:** Escaped text or safe link handling — **no script execution** in default pipeline.

### Plain-text UIs (good)

- **AI chat** (`AiChatTab.tsx`): message `content` rendered as text nodes, not markdown.
- **Support chat** (`SupportChatTab.tsx`): `text` field displayed directly in `<p>` — user/support body shown as text; if backend stored HTML, React would escape it.

### User-controlled display

Names, emails, symbols, table cells generally flow through React text binding — **safe by default**. Promotion images use `<img src={url}>` — supply-chain / XSS via `javascript:` src is browser-dependent (usually blocked).

### `iframe` / PDF

**Voiso admin panel** — no sandbox:

```160:165:src/features/adminVoiso/pages/AdminVoisoPage.tsx
              <iframe
                src={voisoPanelUrl}
                allow="microphone; camera; autoplay; clipboard-read; clipboard-write; display-capture"
                className="h-[720px] w-full border-0"
                title="Voiso Agent Panel"
```

Third-party trusted origin (Voiso) — acceptable if Voiso is contractual; **`sandbox` not applied** (FE-X01 Low).

**KYC PDF preview** uses `<embed src={blob URL}>` from authenticated fetch — not user-supplied URL; **no sandbox** on embed (FE-X02 Low).

### Email templates (admin)

Edited as **plain text** in `<Input>` / textarea; table shows truncated body as text — **not rendered as HTML** in admin UI. Server sends HTML emails separately (backend concern).

### Inline event handlers in templates

**None found** in React source.

---

## 3.3 Secret / configuration leakage in bundle

- **No API keys** in `aiConfig.api.ts` / `AiSettingsTab` — only `apiKeyConfigured` booleans from server.
- **Voiso panel URL** baked at Docker build — public embed URL, not a credential.
- **No hardcoded JWT secrets** — does not rely on Auth F4 dev fallback in frontend code.
- **Source maps:** `vite.config.ts` does not set `build.sourcemap`; Vite default production build is **no source maps** unless overridden — **OK**.
- **Comments:** Dev-oriented comments in `http.ts` mention `DATABASE_URL` in generic 500 message (informational for operators, not a secret leak).

---

## 3.4 Trust in backend data

### Permission cache

```33:44:src/shared/utils/permissions.ts
export function getCurrentUserPermissions(user: User | null): string[] {
  if (!user) return []
  if (Array.isArray(user.permissions)) return user.permissions
  return getPermissionsForRole(user.role)
}
```

- Permissions come from **login / `me`** responses.
- Refreshed on `refreshUser()` after token refresh and on `hydrateFromStorage()`.
- **`super_admin`:** `canAccess` always true (frontend only).
- **`AdminGuard`:** role allowlist — a user with `role: admin` but empty permissions could enter admin shell then hit `AccessDenied` per route — OK split.

### WebSocket cross-tenant trust (deposit broadcast)

**User deposit flow** — filters by user id:

```26:29:src/features/wallet/hooks/useDepositFlow.ts
        if (event.type === 'deposit.request.approved') {
          const { payload } = event
          const userId = payload.userId || (payload as any).userId
          if (userId === user?.id?.toString()) {
```

**Admin finance panel** — **no user filter** on `deposit.request.created` / `approved`:

```62:71:src/features/adminFinance/components/FinanceTransactionsPanel.tsx
        if (event.type === 'deposit.request.created') {
          const payload = event.payload as any
          const amount = payload.amount || 0
          const userId = payload.userId || payload.user_id || ''
          toast.success(
            `💰 New deposit request: $${amount...} from user ${userId.slice(0, 8)}...`,
```

Combined with **ws-gateway broadcasting deposits to all connections** (prior audit), any authenticated user’s client may receive other users’ deposit events; user wallet hook ignores wrong user, but **admin toasts/lists may flash wrong data** until refetch. **FE-T01 (Medium)** — defense-in-depth: filter WS deposit events by `payload.userId` in all subscribers.

**Support chat** — filters WS by `payloadUserId !== userId` — **good pattern**.

**AI chat** — ignores events when `payload.conversationId !== convId` — **good**.

**AI reports WS** — relies on backend routing to admin’s connections only; store does not filter by `admin_user_id` (relies on NATS subject + gateway).

### Admin “login as user”

Opens **new tab**; does not store two JWTs in one store — **good**. Missing **visual impersonation banner** in terminal (FE-T02 Low) — admin may forget they act as user.

---

## 3.5 CSRF protection

- Auth uses **`Authorization: Bearer`** header — **not CSRF-vulnerable** to classic cross-site form POST (no automatic cookie credentials).
- nginx sets `Access-Control-Allow-Credentials: true` with reflected `Origin` — relevant only if cookies were added later.
- **No CSRF tokens** — acceptable for bearer-only SPA.

---

## 3.6 Dependency vulnerabilities

`npm audit` (2026-05-19): **15 vulnerabilities (9 high, 6 moderate)**.

Notable:

| Package | Severity | Note |
|---------|----------|------|
| `rollup` 4.x | High | Path traversal in build tool (dev/build-time) |
| `ws` 8.x | Moderate | Memory disclosure (devDependency + test tooling) |
| `postcss` | Moderate | XSS in CSS stringify (build-time) |
| `esbuild` / `vite` chain | High | Transitive via toolchain |

Runtime deps (`react`, `react-markdown`, `zod`, `@tanstack/*`) — audit output dominated by **dev/build** chain. Still run `npm audit fix` in CI.

**No `axios`** — avoids historic axios CVE class; uses `fetch`.

---

## 3.7 Token transmission and interception

| Check | Result |
|-------|--------|
| API URL | Same-origin prod; `VITE_API_URL` override for dev |
| WS | `wss` when page is HTTPS |
| Mixed content | No routine `http://` asset loads in app code; dev proxy uses HTTP to localhost |
| Hardcoded secrets in WS | None |

---

## 3.8 Login flow

```43:55:src/pages/auth/LoginPage.tsx
  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)
    try {
      await login(data.email, data.password)
      ...
      navigate('/admin/dashboard' or '/')
```

- Token stored in Zustand **before** `navigate` — synchronous `set` in `login()` — **no race** on same tab.
- **Password:** `PasswordField` → `type="password"` with visibility toggle (client-only).
- **Remember me** checkbox exists in schema but **not wired** to different storage — tokens always persisted the same way.

---

## 3.9 Logout flow

```128:154:src/shared/store/auth.store.ts
      logout: async () => {
        clearProactiveAccessTokenRefresh()
        ...
        await logoutApi(state.refreshToken)  // when present
        set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false })
        localStorage.removeItem('token')
        sessionStorage.removeItem('token')
```

| Step | Done? |
|------|-------|
| Clear tokens in store / persist | Yes |
| Call backend logout | Yes (best-effort) |
| Clear React Query cache | **No** global `queryClient.clear()` (FE-L01 Medium) |
| Disconnect WS | Not explicit in logout (connections may linger until refresh) |
| Redirect login | Callers use `navigate` or `window.location.href` ad hoc |

---

## 3.10 Multi-tab / multi-window

- **Zustand persist** uses `localStorage` — **other tabs** receive storage updates on write (browser `storage` event); rehydration behavior is **not explicitly synchronized** for in-memory state — second tab may show stale user until reload/hydrate.
- **Logout in one tab:** clears `auth-storage`; other tabs may not logout until next read — **FE-M01 Medium**.
- **Impersonation:** only affects new tab; admin tab unchanged — **good**.

---

## 3.11 Feature-specific audits

### Trading terminal

- **Place order:** `canPlaceOrder = tradingAccess === 'full'`; submit disabled when `!wsConnected`, margin checks, etc. Backend still authoritative.
- **Close positions:** `canClosePosition = tradingAccess !== 'disabled'` — close-only users can close; fully disabled cannot.
- **Close all:** Confirmation dialog in `BottomDock.tsx` (~1593–1645).
- **WS offline:** Submit disabled when `!wsConnected` on order buttons.

### Admin user management

- `AdminGuard` + `AdminRouteGuard` — layered.
- Impersonation — **FE-A01**.
- User details modal fetches by user id from route/modal props — **cannot fix backend IDOR**; does not embed secrets.

### AI features (baseline)

- No provider key in bundle ✓
- Markdown safe ✓
- Chat WS filters `conversationId` ✓
- Reports WS ingests all `ai.report.delta` on connection — OK if only admins receive them

### KYC

- Client: `ALLOWED_FILE_TYPES`, “max 10 MB” copy — server must enforce (out of scope).
- Preview via blob + `<img>` / `<embed>` — OK for binary from API.

### Settings (admin)

- AI/Voiso/MMDPS keys: `type="password"` inputs; not echoed in GET responses.

---

## 3.12 Error handling

- `getApiErrorMessage()` surfaces **`error.message` from API JSON** — can expose backend strings (e.g. SQL-ish messages if backend leaks) — **FE-E01 Low/Medium**.
- HTTP 500 fallback mentions `DATABASE_URL` / auth-service — slightly operational.

```177:179:src/shared/api/http.ts
      const message = response.status === 500
        ? 'Server error. If this persists, ensure auth-service is running and DATABASE_URL is set (check server logs).'
```

- NATS AI errors: `AiChatTab` does not display WS `detail` field — **good**; server still sends it on wire.

---

## 3.13 Console / logging

| Location | Issue |
|----------|-------|
| `wsClient.ts:292` | Logs **first 20 chars of JWT** |
| `useWebSocket.ts` | 45+ `console.log` calls; logs message payloads (ticks, auth flow) |
| `useDepositFlow.ts` | Logs wallet balance updates |
| `usePriceStream.ts` | Verbose tick logging |

**FE-L02 (High)** — Remove or gate behind `import.meta.env.DEV` for production builds.

**FE-L03 (Medium)** — Align with ws-gateway F11: never log token substrings.

---

## 3.14 Open redirect

**Impersonate `redirect` param:**

```41:43:src/pages/auth/ImpersonatePage.tsx
        const redirectTo = params.get('redirect')
        if (redirectTo && redirectTo.startsWith('/')) {
          navigate(redirectTo, { replace: true })
```

**FE-R01 (Medium)** — `//evil.com` **starts with `/`** in JavaScript → `navigate('//evil.com')` can open external origin (protocol-relative). Fix: require `redirectTo.match(/^\/[^/]/)` or allowlist paths.

Login page does not use `?redirect=` query param — **no open redirect there**.

---

## 3.15 Clickjacking

`deploy/nginx-default.conf` — **no** `X-Frame-Options`, **no** `Content-Security-Policy`, **no** `frame-ancestors` for the SPA.

**FE-CSP01 (Medium)** — Add at nginx: `X-Frame-Options: DENY` or CSP `frame-ancestors 'self'`.

---

## 3.16 Cross-origin and CSP

- `index.html` — single module script, **no CDN scripts**.
- Fonts/styles — bundled via Vite/Tailwind (no external Google Fonts in `index.html`).
- **Inline scripts:** none beyond Vite bundle.
- Strict CSP feasible with `script-src 'self'`; would need hash/nonce if inline styles added.

---

## 3.17 Production build artifacts

- Docker multi-stage build → nginx static `dist/`.
- **Source maps:** not enabled in Dockerfile/`vite.config.ts` — good.
- **Mocks:** `features/*/mocks/` exist — ensure tree-shaking excludes them from routes (import-only in dev paths — spot-check if any mock imported in prod code; not exhaustively verified).

---

## 3.18 Service Worker / PWA

**No service worker** registration found — **no cache poisoning risk** from SW.

---

# 4. Strengths

1. **No `dangerouslySetInnerHTML`** across the codebase.
2. **Bearer-only auth** — strong CSRF posture for SPA.
3. **Centralized `http()`** with 401 refresh coalescing and logout on refresh failure.
4. **Admin route permissions** driven by API grants; `AdminRouteGuard` per path — better than role-only admin UI.
5. **AI reports markdown** matches AI audit hygiene (no `rehype-raw`).
6. **Support / AI chat** WS handlers filter by user or conversation id.
7. **Trading terminal** disables order entry when WS disconnected and enforces `tradingAccess` on client for UX.
8. **Password fields** use shared `PasswordField` component.
9. **Production WS** defaults to `wss://` on HTTPS pages.
10. **Secrets not baked into bundle** for AI, Voiso, or MMDPS keys.

---

# 5. Trust Score Breakdown

| Category | Score | Notes |
|----------|------:|-------|
| Token storage security | 3/10 | localStorage + URL hash impersonation |
| XSS resistance | 8/10 | React default + safe markdown |
| Secret leakage in bundle | 8/10 | Only public URLs in env |
| CSRF protection | 9/10 | Bearer-only |
| Dependency hygiene | 5/10 | 15 npm audit issues |
| Trust boundary (backend authority) | 6/10 | Deposit WS; permissions refreshed |
| Error message safety | 6/10 | API messages passed through |
| Logging hygiene | 3/10 | JWT prefix + verbose WS logs |
| Build/CI safety | 7/10 | No prod sourcemaps in config |
| Multi-tab correctness | 5/10 | No explicit cross-tab logout sync |

**Harmonic mean ≈ 5.4 → reported 5/10**

---

# 6. Production Go-Live Verdict

## 🟡 Conditional no-go

Blockers before treating frontend as production-hardened:

1. Remove tokens from impersonation URL (use `postMessage`, one-time code, or server-side session handoff).
2. Strip/guard production logging (especially JWT fragments).
3. Fix impersonate open redirect (`//`).

Accept **localStorage JWT** only with documented XSS controls (CSP, no raw HTML, regular dependency patches).

---

# 7. Prioritized Fix List

| # | Finding | Sev | Effort | Sprint |
|---|---------|-----|--------|--------|
| 1 | FE-A01: Impersonation without URL tokens | Critical | M | 1 |
| 2 | FE-L02/L03: Dev-only logging; no JWT in logs | High | S | 1 |
| 3 | FE-A02: Document XSS risk; plan httpOnly BFF or token rotation | High | L | 2 |
| 4 | FE-R01: Impersonate redirect allowlist | Medium | S | 1 |
| 5 | FE-T01: Filter deposit WS events by user in all handlers | Medium | S | 1 |
| 6 | FE-L01: `queryClient.clear()` on logout | Medium | S | 1 |
| 7 | FE-M01: `storage` listener → logout other tabs | Medium | S | 2 |
| 8 | FE-CSP01: nginx `frame-ancestors` / XFO | Medium | S | 1 |
| 9 | FE-T02: Impersonation banner in terminal | Low | S | 2 |
| 10 | npm audit fix + CI gate | Medium | S | 1 |
| 11 | FE-X01: Voiso iframe `sandbox` + minimal `allow` | Low | M | 3 |

---

# 8. Cross-Module Notes

| Backend area | Frontend implication |
|--------------|---------------------|
| **Auth F8 impersonation** | Frontend chooses worst transport (URL hash); backend should issue one-time exchange code. |
| **ws-gateway F6 / deposit broadcast** | Finance toasts and invalidations should filter `userId`; users may see spurious notifications until gateway fixed. |
| **Auth F4 JWT dev secret** | Frontend does not embed secret; still sends whatever token API returns. |
| **AI audit** | Frontend AI layer is reference implementation for markdown + no API keys. |
| **Admin IDOR (users, reports)** | UI will display any data API returns — no extra leakage beyond backend. |
| **nginx** | Add security headers at `deploy/nginx-default.conf` for clickjacking and future CSP. |

---

*End of audit.*
