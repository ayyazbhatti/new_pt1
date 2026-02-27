# Appointment Scheduling Module – Complete Plan & Functionalities

**Status:** Plan (ready for implementation approval)  
**Scope:** Full appointment scheduling + calendar system  
**Goal:** Single document covering all requirements, edge cases, and calendar functionalities before implementation.

---

## 1. Executive Summary

This module provides **appointment scheduling** with **full calendar support**: resources (people, rooms, services), availability, bookable slots, appointments (create/reschedule/cancel), and calendar views (day/week/month) with time zones, recurrence, notifications, and optional external calendar sync. The plan below lists every functional area and edge so nothing is missed at build time.

---

## 2. Core Concepts (Recap)

| Concept | Description |
|--------|-------------|
| **Resource** | Bookable entity: person (e.g. advisor), room, or service. Has availability and optional capacity. |
| **Availability / schedule** | When a resource can be booked: working hours, breaks, overrides, holidays. |
| **Slot** | A bookable time window (e.g. 30 min) derived from availability minus existing appointments. |
| **Appointment** | A confirmed booking: resource + start/end + attendee(s) + status + optional type/notes. |
| **Calendar** | UI and data view of appointments/slots by day/week/month; can be per resource or per user. |

---

## 3. Functional Requirements (Complete List)

### 3.1 Resource Management

- Create, edit, archive resources (name, type, timezone, default duration, buffer between appointments).
- Optional: link resource to a user (e.g. “Dr. Smith” = user_id) for “my calendar” and permissions.
- Optional: capacity (e.g. “Group session: 10 attendees”) for multi-attendee slots.
- Working hours: recurring weekly pattern (e.g. Mon–Fri 9–17) and one-off overrides (e.g. closed Dec 25, extra hours on a specific date).
- Blocked time: out-of-office, lunch, meetings that are not bookable by clients.

### 3.2 Availability & Slots

- Compute “free slots” for a resource over a date range: working hours − existing appointments − blocked time − buffer.
- Configurable slot duration (e.g. 15 / 30 / 60 min) per resource or per appointment type.
- Minimum advance booking (e.g. “book at least 2 hours ahead”).
- Maximum advance booking (e.g. “book up to 30 days ahead”).
- Optional: different availability per “appointment type” or “service” (e.g. “Consultation” vs “Follow-up”).

### 3.3 Appointments (CRUD + lifecycle)

- **Create:** Pick resource (optional service/type), date, time from free slots, duration, attendee (user or external email/phone), notes. Enforce no double-booking.
- **Read:** List appointments (mine, per resource, or admin “all”) with filters: date range, resource, status, attendee.
- **Update:** Reschedule (change time/date), change attendee, notes, or status. Revalidate no double-booking on reschedule.
- **Cancel:** Soft cancel (status = cancelled); optional “cancel by” deadline (e.g. 24h before).
- **Status lifecycle:** e.g. `scheduled` → `confirmed` → `completed` | `cancelled` | `no_show`. Optional: `pending_approval` if approval workflow is used.

### 3.4 Double-booking & conflicts

- One appointment per resource per time (no overlapping start/end). Enforce in DB (constraint or unique index) and in API (check before insert/update).
- Optional: multi-resource appointments (e.g. room + 2 people) require all resources free; conflict = if any is busy.
- UI: show conflicts clearly in calendar (e.g. red or “unavailable”).

### 3.5 Time zones

- Store all start/end in **UTC** in DB.
- Resource and user have timezone (or use platform default). Display and “today” logic use correct timezone.
- Slot generation and “available today” use resource (or user) timezone for “day” boundaries.

### 3.6 Recurrence (optional but recommended)

- Recurring appointments: “Every Tuesday 10:00 for 5 occurrences” or “Weekly until date”.
- Store either: (a) one parent + generated instances, or (b) explicit series with recurrence rule (RRULE-like). Cancelling “this instance” vs “all future” vs “whole series” must be defined.
- Calendar view must show all instances and support “edit this / edit all”.

### 3.7 Notifications & reminders

- **On create/update:** Email (and optional in-app) confirmation with date, time, resource, link to “add to calendar” or “view/cancel”.
- **Reminders:** e.g. 24h and/or 1h before (email or push). Configurable per resource or globally.
- **On cancel:** Notify attendee and optionally resource owner.
- **On reschedule:** Notify both parties with new time.

### 3.8 Permissions & visibility

- **End user:** See “my appointments” (where they are attendee); book only against resources they are allowed to (e.g. public list or by group).
- **Resource owner:** See all appointments for their resource(s); may cancel/reschedule.
- **Admin:** See all resources and appointments; manage resources, overrides, and optionally approve bookings.
- Integrate with existing auth (JWT, roles) and permission model (e.g. `appointments:view`, `appointments:book`, `appointments:manage`, `appointments:admin`).

### 3.9 Audit & compliance

- Log who created/updated/cancelled each appointment and when (audit table or fields on appointment).
- Optional: retain cancelled appointments for reporting and dispute resolution.

---

## 4. Calendar Functionalities (Dedicated Section)

### 4.1 Calendar views (UI)

- **Day view:** One day, one or more resources; time grid (e.g. 8:00–18:00) with appointments as blocks. Click empty slot → quick book.
- **Week view:** 7 days, same time grid; optional resource column or row.
- **Month view:** Month grid; cells show appointment count or indicators; click day → day view or list.
- **List view:** Chronological list of appointments (with filters); good for “my appointments” and admin lists.
- **Resource view:** One resource’s calendar (day/week/month) for staff/admin.

### 4.2 Calendar behaviour

- **Navigation:** Previous/next day/week/month; “today”; optional date picker.
- **Time range:** Configurable visible hours (e.g. 7–20); scroll or zoom if needed.
- **Appointment blocks:** Display start–end, title (e.g. “John D. – Consultation”), optional color by status/type/resource. Click → detail or quick actions (reschedule, cancel).
- **Drag-and-drop (optional):** Reschedule by dragging appointment to new slot; revalidate and show error if conflict.
- **Current time indicator:** Line or highlight for “now” in day/week view.
- **Empty slot click:** Opens booking flow with pre-filled resource and time.

### 4.3 Multiple calendars / overlay

- **My appointments:** User’s own bookings (as attendee).
- **Resource calendar(s):** One or more resources’ appointments (for staff). Toggle visibility per resource.
- **Overlay:** Show multiple resources in same view (e.g. different rows or columns) with distinct colors.
- **Legend:** Status or resource legend for color coding.

### 4.4 Calendar export & import

- **Export:** “Download as iCal” or “Add to calendar” link (`.ics` or webcal) so users can see appointments in Google Calendar, Outlook, Apple Calendar.
- **Export range:** e.g. “next 30 days” or “this month”.
- **Import (optional):** Allow resource owner to import “blocked” or “busy” periods from external calendar to reduce availability (e.g. sync with Google so external meetings block slots).

### 4.5 External calendar sync (optional)

- **Outbound:** Publish feed (read-only) so resource’s appointments appear in their Google/Outlook (via iCal URL or API).
- **Inbound:** Pull “busy” from Google/Outlook so those times are not offered as bookable (avoids double-booking with external meetings).
- **Two-way (advanced):** Create appointment in our system → create event in resource’s Google Calendar; cancel here → delete/update there.

### 4.6 Holidays & non-working days

- **Global/platform calendar:** e.g. “Company holidays” – no slots offered on those days (or optional override per resource).
- **Per-resource:** “Out on Dec 24–26” as override. Calendar UI greys out or hides those days for that resource.

### 4.7 Time zone in calendar

- Show all times in user’s (or selected) timezone in UI.
- When booking, show “Your time” and optionally “Resource time” to avoid confusion for remote resources.
- “Today” and “business hours” respect resource (or user) timezone.

---

## 5. Additional Features (Often Required)

### 5.1 Waitlist

- When a slot is full (or no slots in desired range), user can “join waitlist” for that resource/date range.
- When a slot opens (cancellation), notify first on waitlist; optional auto-expire after X hours if no response.

### 5.2 Approval workflow (optional)

- Status `pending_approval`: booking request created but not yet confirmed. Resource owner or admin approves/rejects.
- On approve → status `scheduled` or `confirmed`; send confirmation. On reject → notify requester (optional: suggest other slots).

### 5.3 Service / appointment types

- Catalog of “services” (e.g. “Initial consultation”, “Follow-up”): each has default duration, optional price, and optionally which resources can deliver it.
- Booking flow: select service → then resource (filtered) → then slot. Duration and buffer come from service/resource.

### 5.4 Payments (optional)

- Require deposit or full payment to confirm. Integrate with existing payment flow; on success set status to `confirmed` and send confirmation.
- Cancellation policy: refund rules (e.g. “full refund if cancelled 24h ahead”).

### 5.5 Pre-appointment forms

- Optional questionnaire or form (e.g. “Reason for visit”, “Insurance ID”) before or at booking. Store with appointment; show to resource owner before appointment.

### 5.6 No-show & completion

- Mark as `no_show` or `completed` after the fact (manual or via “check-in” flow). Used for reporting and optional automatic reminders (“if no check-in 10 min after start, mark no_show”).

### 5.7 Reporting & analytics

- Utilization: % of available slots that were booked (per resource, per period).
- Popular times, no-show rate, cancellation rate. Optional dashboard for admin.

### 5.8 Mobile & accessibility

- Calendar and booking usable on small screens (responsive or dedicated mobile layout).
- Keyboard navigation and screen-reader friendly (ARIA, semantic HTML).
- Touch-friendly slot selection and drag (if supported).

### 5.9 Localization

- Date/time format by locale; optional multi-language labels (e.g. “Appointment”, “Cancel”, “Reschedule”).
- First day of week (Sunday vs Monday) in week/month views.

---

## 6. Data Model (Logical)

### 6.1 Tables (suggested)

- **appointment_resources**  
  id, name, type (person|room|service), user_id (nullable), timezone, default_duration_min, buffer_min, capacity, status (active|archived), created_at, updated_at.

- **resource_availability**  
  id, resource_id, day_of_week (0–6), start_time, end_time (time of day); or use “override” rows with date range + start/end for one-off open/closed.

- **resource_blocks**  
  id, resource_id, start_utc, end_utc, reason (optional). Non-bookable time.

- **appointments**  
  id, resource_id, start_utc, end_utc, status, attendee_user_id (nullable), attendee_email, attendee_name, appointment_type_id (nullable), notes, created_by, created_at, updated_at, cancelled_at (nullable). Optional: recurrence_parent_id, recurrence_rule.

- **appointment_audit** (optional)  
  id, appointment_id, action (created|updated|cancelled|rescheduled), by_user_id, at_utc, old_values (jsonb), new_values (jsonb).

- **appointment_reminders** (optional)  
  id, appointment_id, remind_at_utc, channel (email|push), sent_at_utc (nullable).

- **waitlist** (optional)  
  id, resource_id, user_id or email, preferred_start_utc, preferred_end_utc, created_at, notified_at (nullable).

- **appointment_types / services** (optional)  
  id, name, default_duration_min, buffer_min, optional price, optional resource filter.

### 6.2 Indexes

- (resource_id, start_utc, end_utc) for conflict checks and calendar queries.
- (attendee_user_id, start_utc) for “my appointments”.
- (start_utc, status) for admin lists and reminders.

---

## 7. API (High Level)

- **Resources:** CRUD; GET list with filters (active, type); GET one.
- **Availability:** GET/PUT for a resource’s schedule; GET/PUT blocks.
- **Slots:** GET `/slots?resource_id=&from=&to=&duration=` → list of { start_utc, end_utc } (or start_utc + duration).
- **Appointments:** POST (create), GET list (filters: resource, attendee, date range, status), GET one, PATCH (reschedule, status, notes), DELETE or PATCH status=cancelled.
- **Calendar feed:** GET `/calendar/feed.ics?resource_id=&from=&to=` (or per user) for iCal export.
- **My appointments:** GET `/appointments/mine?from=&to=`.
- **Reminders (internal):** Job or cron that selects appointments with remind_at_utc in past and not sent, sends email, marks sent.
- **Waitlist (optional):** POST join, GET list for admin, PATCH notify/expire.

---

## 8. Frontend Structure (Suggested)

- **Routes:** e.g. `/appointments` (list/calendar), `/appointments/book`, `/appointments/:id`, `/admin/appointments`, `/admin/resources`, `/admin/availability`.
- **Components:** Calendar (day/week/month), SlotPicker, AppointmentForm, AppointmentCard, ResourcePicker, AvailabilityEditor. Reuse layout and guards (e.g. AdminGuard for admin routes).
- **State:** Server state (React Query) for resources, slots, appointments; optimistic updates on create/reschedule/cancel.
- **Notifications:** Use existing email (and optional in-app) for confirmations and reminders.

---

## 9. Edge Cases Checklist

| Edge case | Handling |
|-----------|----------|
| Double-booking | DB constraint or unique index + API check before insert/update. |
| Time zone “midnight” | Use resource (or user) timezone for “day”; store UTC. |
| Recurrence “edit this vs all” | Store instance override or exception list; API accepts scope. |
| Slot already taken (race) | Optimistic lock (version) or re-check in transaction before insert. |
| Cancel after cutoff | Reject with message or allow with “late cancel” flag for reporting. |
| Resource deleted/archived | Do not offer in slot search; existing appointments may stay for history or cascade. |
| External calendar sync down | Degrade gracefully (e.g. skip inbound busy); log errors. |
| All-day events | Optional; store as start_utc 00:00–23:59 in resource TZ; exclude from slot grid or show as full-day block. |
| Overbooking (capacity &gt; 1) | Count appointments per slot; allow up to capacity; waitlist when full. |
| Reminder already sent | Idempotent: check sent_at before sending; update sent_at. |

---

## 10. Scope Tiers (Implementation Order)

| Tier | Scope |
|------|--------|
| **Tier 1 – MVP** | Resources + working hours; free slots; create/list/cancel appointments; no double-book; timezone; basic list view + simple day view; confirmation email. |
| **Tier 2 – Standard** | Recurrence (basic); reminders (e.g. 24h); week/month calendar views; “my appointments”; resource calendar; permissions; audit log. |
| **Tier 3 – Full** | Waitlist; approval workflow; appointment types/services; iCal export + “add to calendar”; no-show/completed; reporting. |
| **Tier 4 – Advanced** | External calendar sync (in/out); payments; pre-appointment forms; drag-and-drop reschedule; localization. |

---

## 11. What Was Explicitly Added vs Original Brief

- **Calendar:** Full section (Section 4): day/week/month views, overlay, export/import, external sync, holidays, time zone in calendar, current time, drag-and-drop.
- **Waitlist:** Section 5.1.
- **Approval workflow:** Section 5.2.
- **Services / appointment types:** Section 5.3.
- **Payments:** Section 5.4.
- **Pre-appointment forms:** Section 5.5.
- **No-show & completion:** Section 5.6.
- **Reporting:** Section 5.7.
- **Mobile & accessibility:** Section 5.8.
- **Localization:** Section 5.9.
- **Recurrence “edit this vs all”:** Section 3.6 and edge cases.
- **Multi-resource appointments:** Section 3.4 (optional).
- **Resource blocks & holidays:** Sections 3.1, 4.6, 6.1.
- **Audit:** Section 3.9 and table 6.1.
- **Data model and indexes:** Section 6.
- **Scope tiers:** Section 10 for phased rollout.

---

## 12. Summary

The appointment system includes: **resources**, **availability**, **slots**, **appointments** (full lifecycle), **calendar views and behaviour**, **export/import and optional external sync**, **notifications**, **permissions**, **recurrence**, **waitlist**, **approval**, **services**, **payments**, **reporting**, and **edge-case handling**. This document is the single reference for the complete plan and functionalities; implementation can follow the scope tiers above.
