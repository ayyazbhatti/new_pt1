# Leads Management – UI Plan & Feature Specification

This document is the **UI/UX and feature specification** for the Leads Management module. It describes every screen, component, modal, and interaction in enough detail to review, approve, and then implement. Once approved, development can follow this plan.

**Related doc:** `LEADS_MANAGEMENT_MODULE.md` (concepts, data model, permissions).

---

## 1. Overview & Design Principles

### 1.1 Purpose

- **Admin-facing:** Only admin/sales/support roles use the leads module (no user-facing leads UI in this plan).
- **Location:** Admin panel, under a dedicated **“Leads”** section in the sidebar.
- **Goals:** List leads, filter/search, view detail, update status/owner, log activities, convert to customer, and view pipeline/reports.

### 1.2 Design Principles

- **Consistent** with existing admin UI: same layout (ContentShell, PageHeader), cards, tables, buttons, and modal patterns.
- **Dense but scannable:** Tables with clear headers, status badges, and quick actions.
- **Progressive disclosure:** List → Detail → Modals for edit/convert; no unnecessary steps.
- **Permission-aware:** Buttons and tabs shown/hidden based on `leads:*` permissions.
- **Responsive:** List stacks or scrolls on small screens; detail view remains usable; modals are full-width on mobile if needed.

### 1.3 Routes & Navigation

| Route | Description | Permission |
|-------|-------------|------------|
| `/admin/leads` | Leads list (default view) + optional pipeline toggle | `leads:view` |
| `/admin/leads/:id` | Lead detail (single lead) | `leads:view` |
| `/admin/leads/reports` | Dashboard / pipeline analytics (optional) | `leads:view_reports` or `leads:view` |

**Sidebar:** New item **“Leads”** with an icon (e.g. Users or Contact icon), between existing admin items. Label: **“Leads”**. Permission: `leads:view` (users without it do not see the menu item or access the routes).

---

## 2. Leads List Page (`/admin/leads`)

### 2.1 Page Structure

- **Page header**
  - **Title:** “Leads”
  - **Description:** One line, e.g. “Manage and convert potential customers. Track status, owner, and activities.”
  - **Primary action:** **“Add lead”** button (visible if `leads:create`). Opens “Add lead” modal or navigates to a create form (see 4.1).
  - **Secondary actions (optional):** “Import” (CSV), “View pipeline” toggle or link to pipeline view. Shown based on permissions.

- **Toolbar (below header)**
  - **View toggle (optional):** “List” | “Pipeline” (Kanban). Default: List. Pipeline shows columns by status (see 2.5).
  - **Filters:** See 2.2.
  - **Search:** See 2.2.
  - **Bulk actions (optional):** When one or more rows are selected: “Change status”, “Assign owner”, “Export selected”. Visible if `leads:edit` or `leads:assign`.

### 2.2 Filters & Search

- **Search field**
  - Placeholder: “Search by name, email, company…”
  - Full-width on mobile; in toolbar on desktop. Debounced (e.g. 300 ms). Searches name, email, company, phone (backend-dependent).
  - Clear button (X) when non-empty.

- **Filter chips / dropdowns**
  - **Status:** Multi-select or single. Options: New, Contacted, Qualified, Proposal sent, Negotiation, Converted, Lost. “All” by default.
  - **Source:** Multi-select. Options: Website form, Landing page, Demo request, Chat, Google ad, Meta ad, Referral, Event, Other. “All” by default.
  - **Owner:** Single or multi-select (list of users with leads access). “All” or “Unassigned” option.
  - **Date range (optional):** Created from/to. Date pickers or presets (Last 7 days, Last 30 days, Custom).
  - **Score (optional):** If lead scoring is enabled: Hot / Warm / Cold or numeric range.
  - Filters are applied together. “Clear filters” resets to defaults. Active filter count or summary shown (e.g. “3 filters active”).

### 2.3 Table (List View)

- **Columns (order and visibility can be configurable later; default order):**
  - **Checkbox** (for bulk select; hidden if no `leads:edit`).
  - **Name** (primary; link to detail page).
  - **Email** (with optional “mailto” or copy).
  - **Company** (optional column; can hide if not B2B).
  - **Source** (badge or text; e.g. “Website”, “Referral”).
  - **Status** (badge: color by status – e.g. blue New, grey Contacted, green Qualified/Converted, red Lost).
  - **Owner** (avatar + name or name only; “—” if unassigned).
  - **Score** (optional; number or Hot/Warm/Cold badge).
  - **Created** (relative or absolute date, e.g. “2 days ago” or “10 Mar 2026”).
  - **Last activity** (relative or “—” if none).
  - **Actions** (dropdown or icon buttons): View, Edit, Convert, Assign, Delete/Archive. Visibility by permission.

- **Row behavior**
  - Click row (or name) → navigate to lead detail `/admin/leads/:id`.
  - Hover: subtle row highlight. Actions column visible on hover if desired.

- **Empty state**
  - If no leads match filters: illustration or icon + “No leads found.” + “Adjust filters” or “Add your first lead” (button if `leads:create`).
  - If no leads at all: “No leads yet. Add a lead or import from CSV.” + “Add lead” button.

- **Loading state**
  - Skeleton rows or spinner in table body. Header and toolbar remain.

- **Pagination**
  - Bottom of table: “Page 1 of N”, Prev/Next, optional page size (10, 25, 50). Or infinite scroll if preferred (document choice).

### 2.4 Bulk Actions

- **Selection:** Checkbox per row + “Select all on page” (and optional “Select all matching filters” with confirmation).
- **Actions bar (sticky or above table when selection > 0):**
  - “N selected” + “Clear selection”
  - “Change status” → dropdown of statuses → confirm → update all selected.
  - “Assign owner” → user picker → confirm → assign.
  - “Export selected” → trigger CSV download for selected rows.
  - “Delete” or “Archive” (optional) → confirmation modal → soft-delete or archive if supported.
- Visibility: only when user has `leads:edit` or `leads:assign` as applicable.

### 2.5 Pipeline View (Kanban) – Optional

- **Toggle:** “List” | “Pipeline” in toolbar. Default: List.
- **Layout:** Horizontal columns, one per status (New, Contacted, Qualified, Proposal sent, Negotiation, Converted, Lost). Converted and Lost can be one column each at the end.
- **Column**
  - Header: status name + count (e.g. “New (12)”).
  - Cards: each lead as a compact card (name, company or email, owner avatar). Sorted by last activity or created.
  - Drag-and-drop: move card to another column to change status (if `leads:edit`). On drop, call API to update status.
- **Card click** → navigate to lead detail.
- **Empty column:** “No leads” or “Drop here” hint.
- **Responsive:** Horizontal scroll on small screens; columns have min-width.

---

## 3. Lead Detail Page (`/admin/leads/:id`)

### 3.1 Page Structure

- **Breadcrumb:** Leads > [Lead name or “Lead #id”].
- **Header**
  - **Title:** Lead name (or “No name” / email if name empty). Editable inline or via “Edit” (optional).
  - **Status badge:** Current status; click or dropdown to change (if `leads:edit`).
  - **Owner:** Current owner with avatar; “Assign” or “Change” opens owner picker (if `leads:assign`).
  - **Actions:** Edit, Convert to customer, Delete/Archive, “More” (e.g. Export, Duplicate if needed). Visibility by permission.

- **Tabs (below header)**
  - **Overview** (default): Contact info, source, score, dates, custom fields. See 3.2.
  - **Activity:** Timeline of notes, calls, emails, status changes. See 3.3.
  - **History (optional):** Full audit log (field-level changes). Optional; can merge into Activity.

### 3.2 Overview Tab

- **Card: Contact information**
  - Fields: Name, Email (with mailto/copy), Phone, Company. Display only; “Edit” opens edit modal or inline form.
  - If no data: “—” or “Not provided”.

- **Card: Lead details**
  - Source (badge or text).
  - Campaign / UTM (if stored).
  - Score (number or Hot/Warm/Cold).
  - Created at, Last activity at, Expected close (optional).
  - Custom fields (if any): label + value.

- **Card: Next step / reminder (optional)**
  - “Follow up by [date]” or “Next: Send proposal”. Editable. Link to add activity with due date.

- **Converted section (if status = Converted)**
  - “Converted on [date]”.
  - Link to **user/account** (e.g. “View customer” → user profile or account page). Display converted user name/email.

### 3.3 Activity Tab

- **Timeline**
  - Chronological list (newest first or oldest first – document preference). Each item:
    - Icon by type (note, call, email, status change).
    - Title/summary (e.g. “Status changed to Qualified”, “Note added”).
    - Body (for notes: full text; for call: duration + summary if stored).
    - Author and date.
  - Empty state: “No activity yet. Add a note or log a call.”

- **“Add activity” area**
  - **Type selector:** Note, Call, Email (or “Email sent”).
  - **Content:** Text area for note; optional fields for call duration, email subject.
  - **Submit** → append to timeline and refresh. Visible if `leads:edit` or dedicated `leads:log_activity`.

### 3.4 Loading & Error States (Detail)

- **Loading:** Skeleton for header and cards, or spinner.
- **Not found (404):** “Lead not found” + “Back to leads” link.
- **Forbidden (403):** “You don’t have permission to view this lead.”
- **Error (5xx):** “Something went wrong. Try again.” + Retry button.

---

## 4. Modals & Forms

### 4.1 Add Lead Modal (or Page)

- **Trigger:** “Add lead” on list page.
- **Title:** “Add lead”.
- **Form fields:**
  - **Name** (required or optional by config).
  - **Email** (required). Validation: format; optional duplicate check (warn if email exists as lead or user).
  - **Phone** (optional).
  - **Company** (optional).
  - **Source** (dropdown; required). Options from lead_sources or fixed list.
  - **Campaign** (optional text).
  - **Status** (default: New). Dropdown.
  - **Owner** (dropdown; optional “Unassigned”). List users with leads access. If round-robin is configured, can show “Assign automatically” or leave unassigned.
  - **Score** (optional; number or Hot/Warm/Cold).
  - **Notes** (optional text area; saved as first activity if provided).
- **Actions:** Cancel, “Create lead”. On success: close modal, show toast “Lead created”, refresh list or redirect to new lead detail.
- **Validation:** Inline errors; submit disabled until required fields valid.

### 4.2 Edit Lead Modal

- **Trigger:** “Edit” on list (row action) or on detail page.
- **Title:** “Edit lead”.
- **Form:** Same fields as Add, pre-filled. Email may be read-only to avoid duplicate key issues (or allow change with warning).
- **Actions:** Cancel, “Save”. On success: close modal, toast “Lead updated”, refresh detail or list.

### 4.3 Convert to Customer Modal

- **Trigger:** “Convert to customer” on list or detail. Visible if `leads:convert` and status ≠ Converted.
- **Title:** “Convert lead to customer”.
- **Content:**
  - Summary: “This will create a user account (or link to existing) and mark the lead as Converted.”
  - **Option A – Create new user:** Show email (read-only), optional fields to pre-fill (name, phone). “Create user and convert.”
  - **Option B – Link to existing user:** Search/select user by email or name. “Link to existing user and convert.”
  - Duplicate check: if lead email already exists as user, suggest “Link to existing user” and show that user.
- **Actions:** Cancel, “Convert”. On success: close modal, toast “Lead converted”, redirect to new user profile or lead detail (with converted state).
- **Error:** If create user fails (e.g. email already exists), show message and allow “Link to existing” instead.

### 4.4 Assign Owner Modal (or Inline)

- **Trigger:** “Assign” / “Change owner” on list (bulk or row) or detail.
- **Content:** Dropdown or searchable list of users (with leads access). Optional “Unassigned”.
- **Actions:** Cancel, “Assign”. On success: close, toast “Owner updated”, refresh.

### 4.5 Add Note / Log Activity Modal (or Inline)

- **Trigger:** “Add note” or “Log call” / “Log email” on detail Activity tab (or from list row menu).
- **Title:** “Add note” / “Log call” / “Log email”.
- **Form:** Type (if not pre-selected), content (required for note), optional call duration, optional scheduled follow-up date.
- **Actions:** Cancel, “Save”. On success: close, toast “Activity added”, refresh activity timeline.

### 4.6 Delete / Archive Lead Modal

- **Trigger:** “Delete” or “Archive” on list or detail. Visible if `leads:delete`.
- **Title:** “Delete lead” / “Archive lead”.
- **Content:** “Are you sure? This action cannot be undone.” (or “Lead will be moved to archive and hidden from the list.” if archive.)
- **Actions:** Cancel, “Delete” / “Archive” (danger button). On success: close, toast, redirect to list or refresh list.

### 4.7 Import Leads Modal (Optional)

- **Trigger:** “Import” in list toolbar.
- **Title:** “Import leads”.
- **Content:** File upload (CSV/Excel), optional “Download template” link. Mapping step: map columns to fields (name, email, source, etc.). Preview first 5–10 rows. Option: “Skip duplicates by email”.
- **Actions:** Cancel, “Import”. On success: toast “N leads imported”, refresh list. Errors: show “M rows failed” and link to error file if generated.

---

## 5. Reports / Dashboard Page (Optional) – `/admin/leads/reports`

### 5.1 Purpose

- High-level metrics and pipeline view for managers. Permission: `leads:view_reports` or `leads:view`.

### 5.2 Layout

- **Page header:** “Lead analytics” or “Leads dashboard”.
- **Cards (top row):**
  - Total leads (all time or filtered period).
  - New this week (or period).
  - Converted this month (or period).
  - Conversion rate % (converted / total in period).
- **Chart / table:**
  - Leads by status (bar or funnel). Count per status.
  - Leads by source (pie or bar). Count or % per source.
  - Conversion rate by source (table: source, total leads, converted, rate %).
- **Table: Top sources** (source, count, converted, conversion rate). Optional “By owner” table.
- **Date range filter** for all metrics (e.g. Last 30 days, Last quarter, Custom).

### 5.3 Empty / No Data

- “No data for this period” or “No leads yet. Data will appear here once leads are added.”

---

## 6. Components & Reusable UI

### 6.1 Status Badge

- **Variants:** New (blue), Contacted (grey), Qualified (green), Proposal sent (amber), Negotiation (amber), Converted (green), Lost (red).
- **Props:** `status` (slug or code), optional `size` (sm/default). Accessible (aria-label with full name).

### 6.2 Source Badge

- **Display:** Short label (e.g. “Website”, “Referral”). Optional icon per source. Neutral color or subtle tint.

### 6.3 Owner Display

- **Avatar** (initials or image) + **name**. Click to open assign modal if permission. “Unassigned” in muted text if no owner.

### 6.4 Score Display (optional)

- **Numeric:** 0–100 with optional color (e.g. red &lt; 30, yellow 30–70, green &gt; 70).
- **Label:** Hot / Warm / Cold with matching color.

### 6.5 Activity Timeline Item

- **Icon** (note, phone, mail, arrow for status change) + **title** + **body** + **author, date**. Consistent spacing and typography.

### 6.6 Empty States

- **Reusable pattern:** Icon/illustration + heading + short description + optional primary button. Used in list (no leads, no results), detail (no activity), reports (no data).

---

## 7. Permissions & Visibility Summary

| Permission       | List view      | Detail view    | Add lead | Edit | Convert | Assign | Delete | Reports |
|------------------|----------------|----------------|----------|------|---------|--------|--------|---------|
| leads:view       | Yes            | Yes            | —        | —    | —       | —      | —      | Yes*    |
| leads:create     | —              | —              | Yes      | —    | —       | —      | —      | —       |
| leads:edit       | —              | —              | —        | Yes  | —       | —      | —      | —       |
| leads:convert    | —              | —              | —        | —    | Yes     | —      | —      | —       |
| leads:assign     | —              | —              | —        | —    | —       | Yes    | —      | —       |
| leads:delete     | —              | —              | —        | —    | —       | —      | Yes    | —       |
| leads:view_reports | —            | —              | —        | —    | —       | —      | —      | Yes     |

*Reports: can be gated by `leads:view_reports` only, or allowed for anyone with `leads:view`. Document choice.

- **Row actions:** Show only actions for which the user has permission.
- **Bulk actions:** “Change status” and “Assign” require `leads:edit` and/or `leads:assign`; “Export” may require `leads:export` if you add it.
- **Scoping:** If “see only my leads” is a rule, filter list and detail by `owner_id = current_user` unless user has “see all” (e.g. admin role).

---

## 8. Responsive Behavior

- **List:** Table scrolls horizontally on small screens if needed; or switch to card list (one card per lead with key fields and actions). Filters collapse into a “Filters” drawer or dropdown on mobile.
- **Detail:** Tabs stack or become dropdown on narrow screens. Cards full-width. Actions in a “More” menu if space is tight.
- **Modals:** Full-screen or near full-screen on mobile; standard width on desktop. Buttons stack (full-width) on small screens.
- **Pipeline:** Horizontal scroll; columns have min-width; touch-friendly drag if supported.

---

## 9. Accessibility & UX Notes

- **Focus management:** Modal open → focus first focusable element; trap focus; on close return focus to trigger. Cancel/Close always available (button or Escape).
- **Labels:** All form fields have visible labels; icons have aria-labels (e.g. “Edit lead”, “Convert to customer”).
- **Loading:** Buttons show loading state (spinner or disabled) during submit. Table/detail show skeleton or spinner; avoid layout shift.
- **Toasts:** Success and error messages for create, update, convert, assign, delete. Dismissible; auto-dismiss after a few seconds.
- **Confirmation:** Destructive actions (delete, archive, bulk status change) use a confirmation modal with clear “Cancel” and “Confirm” (e.g. “Delete lead”).

---

## 10. Feature Checklist (Implementation Reference)

Use this as a checklist when building. Mark phases (e.g. Phase 1: List + Detail + Add/Edit; Phase 2: Activity + Convert; Phase 3: Pipeline + Reports).

- [ ] **Navigation:** Sidebar item “Leads”, route `/admin/leads`, permission `leads:view`.
- [ ] **List page:** Header, “Add lead” button, search, filters (status, source, owner, date), table with columns (name, email, company, source, status, owner, created, last activity, actions), pagination, empty state, loading state.
- [ ] **Row actions:** View (navigate to detail), Edit, Convert, Assign, Delete (by permission).
- [ ] **Bulk actions:** Select rows, Change status, Assign owner, Export selected (optional).
- [ ] **Detail page:** Breadcrumb, header (name, status, owner, actions), tabs (Overview, Activity), Overview (contact card, lead details card, converted section if applicable), Activity (timeline, add note/call/email).
- [ ] **Add lead modal:** Form (name, email, phone, company, source, campaign, status, owner, score, notes), validation, submit.
- [ ] **Edit lead modal:** Same form, pre-filled, save.
- [ ] **Convert modal:** Create new user or link existing, duplicate handling, submit.
- [ ] **Assign owner modal:** User picker, submit.
- [ ] **Add activity modal (or inline):** Type, content, optional follow-up date, submit.
- [ ] **Delete/Archive modal:** Confirmation, submit.
- [ ] **Import modal (optional):** File upload, mapping, preview, submit.
- [ ] **Pipeline view (optional):** Kanban columns by status, drag-and-drop, card click to detail.
- [ ] **Reports page (optional):** KPI cards, leads by status/source, conversion by source, date range.
- [ ] **Status badge, source badge, owner display, score display** components.
- [ ] **Permissions:** All buttons and views gated by `leads:*` as above.
- [ ] **Responsive:** List, detail, modals usable on mobile.
- [ ] **Error and loading states** everywhere applicable.

---

## 11. Out of Scope (For Later)

- **User-facing lead capture form** (public form that creates a lead) – can be a separate page or widget; API contract is in scope, UI can be later.
- **Email integration** (send/receive emails from the UI) – optional; for now “Log email” is manual.
- **Automated lead scoring** – Phase 1 can be manual score only; rules engine later.
- **Assignment rules config UI** – Phase 1 can be manual assignment only; rule builder later.
- **Custom fields config** – Phase 1 can use fixed fields; admin UI to add custom fields later.
- **Lead merge** – Merge two duplicate leads; can be added after MVP.

---

*Once this UI plan is approved, implementation can follow this document and the data model in `LEADS_MANAGEMENT_MODULE.md`.*
