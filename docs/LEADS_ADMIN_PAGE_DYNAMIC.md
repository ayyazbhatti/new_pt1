# Making `/admin/leads` Dynamic

The page at **http://localhost:5173/admin/leads** is **code-complete** but uses **mock data** only. Below is what to change so it uses the real backend (core-api + Postgres).

---

## Current state

- **LeadsPage** (`src/features/leads/pages/LeadsPage.tsx`) uses:
  - `useLeads(params)` → `leads.api.listLeads()` → **mock**
  - `useLeadStages()` → `leads.api.listStages()` → **mock**
  - `useLeadRealtime()` → **mock** WebSocket
- **leads.api.ts** delegates every function to **leads.mock.ts** (in-memory data).
- **Backend (core-api)** already has: `GET/POST /api/leads`, `GET /api/leads/:id`, `GET /api/leads/:id/activities|tasks|messages`, `GET /api/lead-stages`, `GET /api/email-templates`, `POST /api/leads` (create). Auth: JWT `Authorization: Bearer <token>`; `team_id` and role come from JWT.

---

## 1. Route leads API to core-api

The app currently proxies **all** `/api` to **auth-service** (port 3000). Leads endpoints live on **core-api** (port 3004).

**Option A – Vite proxy (recommended)**  
In `vite.config.ts`, extend the API proxy so that leads-related paths go to core-api:

- Paths like `/api/leads`, `/api/lead-stages`, `/api/email-templates` → `http://localhost:3004`
- All other `/api` and `/v1` → keep current target (e.g. `http://localhost:3000`)

Use the same `Authorization` header and (if needed) `host` handling as the existing proxy.

**Option B – Separate base URL**  
- Set `VITE_LEADS_API_URL=http://localhost:3004` (or your core-api URL).
- In `leads.api.ts` use this base for all leads requests and send the same Bearer token.
- Ensure core-api allows CORS from `http://localhost:5173`.

---

## 2. Replace mock with real HTTP in `leads.api.ts`

- Keep the same **function signatures** and **return types** (so hooks and components don’t need to change).
- Replace each implementation with a real `fetch` (or your existing `http()` helper) to the backend.

Examples:

- `listLeads(params)` → `GET /api/leads?page=1&page_size=20&status=...&stage_id=...&owner_user_id=...&search=...` (build query from `ListLeadsParams`).
- `getLead(id)` → `GET /api/leads/:id`.
- `createLead(payload)` → `POST /api/leads` with body (see “Request body format” below).
- `listStages()` → `GET /api/lead-stages`.
- `listActivities(leadId)`, `listTasks(leadId)`, `listMessages(leadId)` → `GET /api/leads/:id/activities`, `.../tasks`, `.../messages`.
- `listTemplates()` → `GET /api/email-templates`.

Use the same auth as the rest of the app (e.g. `http()` from `@/shared/api/http` if it uses the same origin/proxy and adds the Bearer token).

---

## 3. Map backend snake_case ↔ frontend camelCase

Backend (Rust/Serde) returns **snake_case** (e.g. `stage_id`, `owner_user_id`, `first_name`, `created_at`). Frontend types use **camelCase** (`stageId`, `ownerUserId`, `firstName`, `createdAt`).

- Either:
  - **In `leads.api.ts`:** after `response.json()`, map each response (e.g. list `items`, single lead, stage, activity, task, message, template) from snake_case to camelCase before returning; or
  - Add a small generic `snakeToCamel(obj)` and use it for all leads API responses.
- For **request bodies** (create lead, update lead, etc.), send **snake_case** if that’s what the backend expects (e.g. `first_name`, `stage_id`, `owner_user_id`). Check core-api and crm-leads types; if they use serde with no rename, send snake_case.

---

## 4. Query params for `listLeads`

Backend expects query params such as: `page`, `page_size`, `status`, `stage_id`, `owner_user_id`, `source`, `country`, `score_min`, `score_max`, `search`.  

In `listLeads(params)` build the query string from `ListLeadsParams` (camelCase) → snake_case param names and only include defined values.

---

## 5. Optional: list users/agents for assign modals

Several components use **mockUsers** (e.g. AssignLeadModal, CreateLeadModal, LeadsFiltersBar). To make assignment dynamic:

- If the backend exposes **GET /api/users** or **GET /api/agents** (or similar), add a small API function and use it instead of `mockUsers`.
- If not, you can keep mock users for now or add a minimal “list team members” endpoint on core-api/auth-service and call it from the frontend.

---

## 6. Real-time updates (WebSocket)

- **Current:** `leads.ws.ts` uses `subscribeLeadWs()` from the mock, which never receives real events.
- **Goal:** Subscribe to the **real** WebSocket (gateway that receives NATS `leads.*` events) and invalidate React Query on events.

Steps:

- In `leads.ws.ts`, replace `subscribeLeadWs` with a subscription to the **same** WebSocket client used elsewhere (e.g. the one that connects to `ws://.../ws` and sends auth).
- When a message is received, parse `type` (e.g. `leads.created`, `leads.updated`, `leads.assigned`, `leads.stage_changed`, `leads.task.created`, `leads.task.completed`, `leads.activity.added`, `leads.message.queued` / `sent` / `failed`) and call `queryClient.invalidateQueries(...)` as in the current `useLeadRealtime` (you can keep the same event names or map backend event names like `leads.updated` → your existing `lead.updated` handling).

---

## 7. Backend endpoints not yet implemented

Core-api currently has only a subset of the full spec. To support the full UI (assign, stage, log call, notes, tasks, send email, etc.) you’ll need to implement and wire:

- PATCH `/api/leads/:id`
- POST `/api/leads/:id/assign`, `/api/leads/:id/stage`, `/api/leads/:id/log-call`, `/api/leads/:id/notes`
- POST `/api/leads/:id/tasks`, GET `/api/tasks?scope=...&status=...`
- POST `/api/tasks/:id/complete`
- POST `/api/leads/:id/send-email` (with Idempotency-Key)
- Lead-stages: POST/PATCH, reorder
- Email-templates: POST/PATCH/DELETE
- GET/PUT `/api/leads-settings`
- GET `/api/leads/metrics`

Until these exist, the UI can still be “dynamic” for list/detail/stages/templates/activities/tasks/messages and create lead; assign, stage, log call, send email, etc. will need either these endpoints or temporary mocks.

---

## 8. Checklist summary

| # | Task | Notes |
|---|------|--------|
| 1 | Route leads API to core-api | Vite proxy or VITE_LEADS_API_URL + CORS |
| 2 | Replace mock with HTTP in `leads.api.ts` | listLeads, getLead, createLead, listStages, listActivities, listTasks, listMessages, listTemplates |
| 3 | Map snake_case ↔ camelCase | Responses (and request bodies if backend expects snake_case) |
| 4 | Build listLeads query params | page, page_size, status, stage_id, owner_user_id, search, etc. |
| 5 | (Optional) Replace mockUsers | Backend user/agent list or keep mock for now |
| 6 | Real-time: use real WebSocket | Subscribe to gateway, invalidate queries on leads.* events |
| 7 | (Backend) Add missing endpoints | PATCH lead, assign, stage, log-call, notes, tasks, send-email, stages/templates CRUD, settings, metrics |

After 1–4 (and optionally 5), the main leads list and detail views can be fully dynamic for read + create. The rest makes assign, stage, communications, and real-time updates work end-to-end.
