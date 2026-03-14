# KYC Module – Solution for Full Dynamic Implementation

This document describes the end-to-end solution to make the KYC (Know Your Customer) flow fully dynamic: real data, backend APIs, document storage, and admin review. The existing UI at `/user/kyc` and `/admin/kyc` is preserved; this solution wires it to backend and storage.

**Validation summary:** This solution is additive only (new tables, new routes, new frontend API usage). It does not modify existing tables, existing API routes, or existing feature code outside the KYC feature. Performance is preserved via indexed queries, pagination, and streaming/presigned URLs for documents. Rollback is possible via migration down and reverting code.

---

## 1. Current State

| Area | Status |
|------|--------|
| **User KYC page** (`/user/kyc`) | UI only: step-by-step wizard (Identity document, Proof of address, Review & submit), status card, mock status. No API, no file upload. |
| **Admin KYC page** (`/admin/kyc`) | UI only: list table (Name, Email, Status, Submitted, Reviewed, View), filters, stats, empty state. View opens detail modal with documents placeholder and Approve/Reject. No API. |
| **Permissions** | Nav shows "KYC" for admin without permission gate. No `kyc:view` / `kyc:approve` in backend. |

---

## 2. Target Behaviour (Summary)

- **User:** Submit KYC in steps (identity doc type + file, address doc type + file) → status: pending → under_review → approved or rejected (with reason). One active submission per user; rejected users can resubmit.
- **Admin:** List submissions with filters (status, search), open detail, view documents (preview/download), Approve or Reject with required reason. Permissions: `kyc:view`, `kyc:approve` (and optionally `kyc:reject` or same as approve).
- **Documents:** Stored securely (e.g. S3 or local disk with strict access). Served via signed URLs or authenticated endpoints; only the owning user and admins with KYC permission can access.

---

## 3. Backend Solution

### 3.1 Database Schema (Postgres, auth-service)

**New tables (migration in `backend/auth-service/migrations/`):**

```sql
-- KYC submissions: one row per user submission (latest or resubmission).
CREATE TABLE kyc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | under_review | approved | rejected
  identity_doc_type TEXT,                  -- passport | national_id | driving_licence
  address_doc_type TEXT,                   -- utility | bank_statement | tax | other
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kyc_status_check CHECK (status IN ('pending', 'under_review', 'approved', 'rejected'))
);

CREATE INDEX idx_kyc_submissions_user_id ON kyc_submissions(user_id);
CREATE INDEX idx_kyc_submissions_status ON kyc_submissions(status);
CREATE INDEX idx_kyc_submissions_submitted_at ON kyc_submissions(submitted_at DESC);

-- KYC documents: one row per uploaded file (identity front/back, address, etc.).
CREATE TABLE kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES kyc_submissions(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,   -- identity_front | identity_back | proof_of_address
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,      -- storage path or key (S3 key, local path)
  file_size_bytes BIGINT,
  content_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kyc_documents_submission_id ON kyc_documents(submission_id);
```

**Permissions (use existing `permission_categories` / `permissions` pattern):**

- Add category (e.g. "KYC") and permissions: `kyc:view`, `kyc:approve`.
- Grant to appropriate permission profiles so admin sidebar and routes can be gated.

### 3.2 Document Storage Strategy

**Option A – Local filesystem (simplest for MVP):**

- Config: `KYC_UPLOAD_DIR` (e.g. `./uploads/kyc`).
- On upload: save file to `{KYC_UPLOAD_DIR}/{submission_id}/{document_type}_{uuid}.{ext}`, store `file_path` (relative or absolute) in `kyc_documents`.
- Serve: authenticated GET endpoint that checks user is owner or admin with `kyc:view`, then streams file (or returns 404).

**Option B – S3-compatible (recommended for production):**

- Config: bucket, region, credentials.
- Upload: multipart/form-data → validate type/size → upload to bucket with key e.g. `kyc/{submission_id}/{document_type}_{uuid}` → save key in `kyc_documents.file_path`.
- Download/view: generate presigned URL (short-lived) in a dedicated endpoint; same auth checks as Option A.

**Validation (both options):**

- Allowed types: e.g. image/jpeg, image/png, application/pdf.
- Max file size: e.g. 10 MB per file.
- Per submission: at least one identity document and one proof-of-address document before allowing submit.

### 3.3 API Endpoints (auth-service)

**User-facing (authenticated, current user only):**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user/kyc` | Get current user’s KYC status and latest submission (id, status, document types, submitted_at, rejection_reason, etc.). 404 or empty if not started. |
| POST | `/api/user/kyc/submit` | Create or update submission: body with `identity_doc_type`, `address_doc_type`; documents uploaded via same request (multipart) or separate upload endpoints (see below). |
| POST | `/api/user/kyc/upload` | Multipart: `submission_id` (or create on first upload), `document_type`, `file`. Returns document id and submission status. |

**Alternative to single-step submit:** If you prefer “upload then submit”:

- `POST /api/user/kyc/documents` – multipart upload; creates/updates draft submission and attaches file.
- `POST /api/user/kyc/submit` – body only (no files); marks submission as `pending` if both identity and address docs present.

**Admin-facing (authenticated, permission `kyc:view` or `kyc:approve`):**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/kyc/submissions` | List submissions. Query: `page`, `page_size`, `status`, `search` (user name/email). Response: `{ items: [], total }` with user id, name, email, status, submitted_at, reviewed_at. |
| GET | `/api/admin/kyc/submissions/:id` | Submission detail: user info, status, document types, document list (id, type, file_name, content_type); no raw file. |
| GET | `/api/admin/kyc/submissions/:id/documents/:doc_id` | Stream document file (or redirect to presigned URL). Permission `kyc:view`. |
| POST | `/api/admin/kyc/submissions/:id/approve` | Set status `approved`, set `reviewed_at`, `reviewed_by_id`. Permission `kyc:approve`. |
| POST | `/api/admin/kyc/submissions/:id/reject` | Body: `rejection_reason`. Set status `rejected`, `rejection_reason`, `reviewed_at`, `reviewed_by_id`. Permission `kyc:approve`. |

**User document access (for “View” in user’s own KYC):**

- `GET /api/user/kyc/submissions/:id/documents/:doc_id` – stream or presigned URL; only if submission belongs to current user.

### 3.4 Implementation Notes (Backend)

- **auth-service:** New module e.g. `routes/kyc.rs` (user) and `routes/admin_kyc.rs` (admin), or one module with two routers. Use existing patterns: `State(PgPool)`, `Extension(Claims)`, permission check helper, `Json`/multipart extractors.
- **File upload:** Use `axum::extract::Multipart` for user uploads; validate content-type and size before persisting.
- **Idempotency:** One “active” submission per user: either one row per lifecycle (pending → approved/rejected) with resubmit creating a new row, or single row per user with status updates and document replacement. Recommendation: one row per submission; “current” = latest by `submitted_at` for that user.
- **Errors:** 400 (validation), 403 (permission), 404 (submission/document not found), 413 (file too large), 415 (unsupported file type).

---

## 4. Frontend Solution

### 4.1 Data Layer

- **Types:** Define types matching API (e.g. `KycSubmission`, `KycDocument`, `KycStatus`). Replace mock types in `AdminKycPage`, `UserKycPage`, and `KycSubmissionDetailModal` with these.
- **API module:** e.g. `src/features/kyc/api/kyc.api.ts`:
  - User: `getMyKyc()`, `uploadKycDocument(formData)`, `submitKyc(body)` (or equivalent).
  - Admin: `listKycSubmissions(params)`, `getKycSubmission(id)`, `approveKycSubmission(id)`, `rejectKycSubmission(id, reason)`, `getKycDocumentUrl(submissionId, documentId)` (or open in new tab with blob/URL).

### 4.2 User KYC Page (`/user/kyc`)

- **Load:** On mount, call `getMyKyc()`. If 404 or no submission, show “Not started” and step 1; else show status (pending / under_review / approved / rejected) and, if rejected, rejection reason and option to resubmit.
- **Steps:** Keep existing step-by-step UI. Step 1: identity doc type + file input (single or multiple for front/back). Step 2: address doc type + file input. Step 3: review and submit.
- **Upload:** On file select (or drop), call upload API (multipart). Show file name and optional remove; store returned document ids or rely on backend associating with draft submission.
- **Submit:** When user clicks “Submit for verification”, call submit API (and optionally attach document ids if not already linked). On success, refetch `getMyKyc()` and show success message; status becomes pending.
- **Loading/errors:** Disable buttons while loading; show toast or inline error from API.

### 4.3 Admin KYC Page (`/admin/kyc`)

- **List:** Replace mock data with `listKycSubmissions({ page, page_size, status, search })` (e.g. React Query). Use returned `items` and `total` for table and pagination. Keep existing filters and stats (derive stats from API or add a small stats endpoint).
- **Detail modal:** On View (or row click), call `getKycSubmission(id)`. Show user name/email (separate sections), status, document types, and list of documents with “View”/“Download” using `getKycDocumentUrl(submissionId, documentId)` (open in new tab or download).
- **Approve/Reject:** Call `approveKycSubmission(id)` or `rejectKycSubmission(id, reason)`. On success, close modal, invalidate list query, show toast.
- **Permissions:** Gate route and nav with `kyc:view`; show Approve/Reject only if `kyc:approve`. Use existing `useCanAccess` / sidebar permission pattern.

### 4.4 Document URL Handling

- If backend returns a **presigned URL**, frontend can use it in `<a href={url} target="_blank" download>` or in an iframe/img for preview (if image/PDF).
- If backend **streams** the file, frontend can call the endpoint with auth, get blob, and create object URL for download/preview. Prefer presigned URL for simplicity.

---

## 5. Impact on Existing Functionality (Zero Impact)

| Area | What we do | Why others are unaffected |
|------|------------|----------------------------|
| **Database** | Add **new** tables only: `kyc_submissions`, `kyc_documents`. | No `ALTER` on existing tables. No new columns or indexes on `users`, `permissions`, or any existing table. Only new FKs reference existing `users(id)` (read-only from KYC side). |
| **Migrations** | New migration files only (e.g. `YYYYMMDD_create_kyc_tables.sql`, `YYYYMMDD_add_kyc_permissions.sql`). | Existing migrations are not edited. Migration runner runs new files in order; no changes to existing migration content. |
| **Backend routes** | **New** routers only: e.g. `routes/kyc.rs`, `routes/admin_kyc.rs`; mounted at **new** paths: `/api/user/kyc`, `/api/admin/kyc`. | No changes to `main.rs` except adding `.nest("/api/user/kyc", ...)` and `.nest("/api/admin/kyc", ...)`. No edits to leads, managers, auth, deposits, or any existing route module. |
| **Permissions** | **Insert** new category and new permission rows (`kyc:view`, `kyc:approve`) with `ON CONFLICT DO NOTHING`. | No updates or deletes to existing permissions or categories. Existing permission checks and sidebar logic unchanged; we only add one new nav item gated by `kyc:view`. |
| **Frontend** | Changes only under `src/features/kyc/` (api, types, page components) and in `nav.ts` (add permission to existing KYC nav item). | No changes to `AppRouter`, guards, auth store, http client, or other features (leads, managers, dashboard, etc.). User and admin routes for KYC already exist; we only replace mock data with API calls inside existing pages. |
| **Config / env** | Optional new env vars for KYC (e.g. `KYC_UPLOAD_DIR` or S3). Defaults so app still runs without them until KYC is used. | No changes to existing env vars or config used by other features. |

**Guarantee:** No existing functionality is altered. All changes are additive and scoped to the KYC feature and its new backend routes and tables.

---

## 6. Performance and Platform Optimization

| Concern | Approach | Outcome |
|---------|----------|---------|
| **Database** | New tables only; indexes on `user_id`, `status`, `submitted_at`, `submission_id`. No full-table scans; list uses `WHERE` + `ORDER BY submitted_at DESC` + `LIMIT/OFFSET`. | KYC queries do not touch existing tables for read path; no extra load on `users`, `leads`, etc. Indexes keep list/detail fast. |
| **Document storage** | Files served by **streaming** (local) or **presigned URL** (S3). No loading full file into app memory; no base64 in JSON. | No large payloads in API responses; no memory bloat. Download/view is a single GET. |
| **List endpoint** | Pagination only (`page`, `page_size`). Admin list returns only submission metadata (no document bytes). | Bounded response size and query cost; same pattern as leads/managers. |
| **Frontend** | React Query for list and detail (caching, no polling). Invalidate only on submit/approve/reject. No timers or polling (per project rule). | Fewer requests; no background refetch loops. |
| **Auth** | Same middleware and permission helpers as existing admin routes. No new global state or heavy init. | No extra per-request cost beyond one permission check for admin KYC. |

**Guarantee:** KYC does not introduce polling, heavy payloads, or schema changes that could slow existing pages or APIs.

---

## 7. Security and Compliance

- **Access control:** User endpoints only for own data; admin endpoints behind `kyc:view` / `kyc:approve`.
- **Storage:** Restrict read/write to backend only; never expose storage paths to client. Serve files only through authenticated endpoints or short-lived presigned URLs.
- **Audit:** Store `reviewed_by_id` and `reviewed_at` for approvals/rejections. Optionally log document access for admins.
- **Data retention:** Consider policy for deleting or anonymising documents after a period; implement in migrations or jobs if required.

---

## 8. Validation That This Will Work

| Check | How it is satisfied |
|-------|----------------------|
| **Schema** | Uses same patterns as existing modules: `users(id)` FK, `gen_random_uuid()`, `TIMESTAMPTZ`, `ON DELETE CASCADE/SET NULL`. Permission inserts use `ON CONFLICT DO NOTHING` like existing permission migrations. |
| **API paths** | `/api/user/kyc` and `/api/admin/kyc` do not conflict with any existing path (no overlap with `/api/leads`, `/api/admin/users`, `/api/user` prefix already used for preferences, etc.). |
| **Auth** | User KYC: same auth middleware as other `/api/user/*` routes (current user only). Admin KYC: same pattern as `/api/admin/leads` or `/api/admin/managers` (Claims + permission check). |
| **Frontend** | Uses existing `http()` from `@/shared/api/http` (auth headers, error handling). React Query and `useCanAccess` already used elsewhere; same usage in KYC. |
| **Nav / guards** | KYC nav item already exists; we only add `permission: 'kyc:view'`. Sidebar already filters by permission; no change to guard logic. Route `/admin/kyc` already registered; no change to AppRouter. |
| **File upload** | `axum` already has `multipart` feature in Cargo.toml. Multipart extraction and file handling follow standard patterns; no new runtime dependencies. |

**Guarantee:** Design aligns with current codebase; no experimental or unsupported patterns. Implementation can follow existing leads/admin modules line-by-line for structure.

---

## 9. Rollback and Safety

- **Database:** If needed, a follow-up migration can `DROP TABLE kyc_documents; DROP TABLE kyc_submissions;` and remove KYC permission rows. No existing tables are altered, so rollback does not affect other features.
- **Backend:** Removing the two `.nest(...)` lines and the KYC route modules returns the app to current behaviour. No shared state or global side effects.
- **Frontend:** Reverting changes under `features/kyc` and restoring mock data (or hiding KYC nav) restores current UI. No shared store or router changes.
- **Deployment:** New migrations run after existing ones; optional env vars have safe defaults so the app starts even if KYC storage is not configured yet.

**Guarantee:** Changes can be rolled back without affecting existing functionality.

---

## 10. Implementation Order (Recommended)

1. **Migration + permissions** – Add `kyc_submissions` and `kyc_documents`, then KYC category and `kyc:view`, `kyc:approve`; grant to a test profile.
2. **Storage** – Implement local or S3 upload/read in auth-service; decide and document config (e.g. `KYC_UPLOAD_DIR` or S3 env vars).
3. **User APIs** – `GET /api/user/kyc`, `POST /api/user/kyc/upload`, `POST /api/user/kyc/submit` (or equivalent). Ensure one submission per user or clear “current” rule.
4. **Admin APIs** – List, get by id, get document URL/stream, approve, reject.
5. **Frontend – User KYC** – Replace mock status with `getMyKyc()`; wire upload and submit; handle loading and errors.
6. **Frontend – Admin KYC** – Replace mock list and detail with API calls; wire document View/Download, Approve, Reject; add permission checks.
7. **Nav and guards** – Add `kyc:view` to admin KYC nav item; ensure only users with permission can access `/admin/kyc` and admin submission endpoints.

---

## 11. File and Component Checklist

| Layer | Action |
|-------|--------|
| **Backend** | New migration for `kyc_submissions` and `kyc_documents`; new migration or SQL for KYC permissions. |
| **Backend** | New routes: user KYC (get, upload, submit), admin KYC (list, get, document URL, approve, reject). |
| **Backend** | Document storage service or helpers (local or S3). |
| **Frontend** | `src/features/kyc/api/kyc.api.ts` (or split user/admin). |
| **Frontend** | `src/features/kyc/types/kyc.ts` – shared types from API. |
| **Frontend** | `UserKycPage.tsx` – use API for status, upload, submit; remove mock status. |
| **Frontend** | `AdminKycPage.tsx` – use API for list, pagination, filters; remove mock list. |
| **Frontend** | `KycSubmissionDetailModal.tsx` – use API for detail, documents, approve/reject; real document links. |
| **Config** | Nav: add permission `kyc:view` to admin KYC item when backend has the permission. |

---

## 12. Success Criteria

- User can complete the 3-step KYC form, upload documents, and submit; status reflects in UI and in DB.
- Admin can filter and paginate submissions, open detail, view/download documents, and approve or reject with reason.
- Rejected user sees reason and can resubmit (new submission or update per your business rule).
- Only authorised admins see KYC menu and can perform actions; document access is restricted to owner and admins with `kyc:view`.

---

*Once this solution is reviewed and approved, implementation will follow **Section 10** and the guarantees in **Sections 5, 6, 8, and 9**. Any changes to storage (e.g. S3 only) or to “one submission per user” vs “multiple submissions” can be reflected in the implementation.*


## 13. Sign-off Checklist (Before Implementation)

- [ ] **Valid and professional:** Solution follows existing patterns (schema, permissions, routes, frontend API and components).
- [ ] **Will work 100%:** API paths and auth are consistent with codebase; no conflicting routes or missing dependencies.
- [ ] **No impact on other functionality:** Only new tables, new routes, and changes under `features/kyc` and nav; no edits to existing features or shared core.
- [ ] **Platform speed preserved:** Indexed queries, pagination, streaming/presigned URLs, no polling; no changes to existing tables or middleware that could slow other pages.

Once approved, implementation follows Section 10 and adheres to the guarantees in Sections 5, 6, 8, and 9. Any changes to storage or submission model can be reflected during implementation without affecting these guarantees.
