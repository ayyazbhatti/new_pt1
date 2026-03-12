# Leads Management Module – Complete Reference

This document describes **leads management** in detail: what it is, how it works, typical features, data model, and how it can fit into a trading or SaaS platform. Use it as a reference when you add the feature later.

---

## 1. What Is Leads Management?

**Leads management** (often part of **CRM – Customer Relationship Management**) is the process of **capturing**, **storing**, **qualifying**, **nurturing**, and **converting** potential customers (**leads**) into paying customers or active users.

- **Lead:** A person or company that has shown interest in your product (e.g. filled a form, clicked an ad, contacted support) but is not yet a customer.
- **Management:** Tracking each lead through stages (e.g. New → Contacted → Qualified → Converted or Lost), assigning owners, logging interactions, and measuring conversion.

In a **trading or prop-firm context**, leads might be:
- Potential **traders** (e.g. signed up for a demo, downloaded a guide, or came from an ad).
- **Affiliates** or partners who refer users.
- **B2B** contacts (brokers, white-label partners).

This doc is generic enough to apply to any of these; you can specialise later (e.g. “trader leads” vs “affiliate leads”).

---

## 2. Why Have a Leads Module?

- **Central place** for all potential customers – no lost contacts in spreadsheets or inbox.
- **Structured pipeline** – see how many leads are at each stage and who owns them.
- **Follow-up** – reminders, tasks, and history so no lead is forgotten.
- **Metrics** – conversion rate, time-to-convert, source performance (which channel brings the best leads).
- **Team alignment** – assignment rules, round-robin, or territory so sales/support know who handles which lead.

---

## 3. Core Concepts

### 3.1 Lead

A **lead** is a record that represents a potential customer. It usually has:

- **Contact info:** Name, email, phone, company (if B2B).
- **Source:** Where the lead came from (e.g. website form, Facebook ad, referral, chat).
- **Status / stage:** e.g. New, Contacted, Qualified, Proposal sent, Converted, Lost.
- **Owner:** The team member responsible for following up.
- **Score (optional):** A number indicating how likely they are to convert (lead scoring).
- **Dates:** Created, last activity, expected close (if you use a sales pipeline).
- **Custom fields:** Industry, account size interest, country, etc.

### 3.2 Lead source

The **source** (or **channel**) answers “where did this lead come from?”. Examples:

- Website contact form  
- Landing page (e.g. “Download guide”)  
- Demo request  
- Chat widget  
- Ad campaign (Google, Meta, etc.) – often with a **campaign** or **utm_*** parameter  
- Referral (existing user or affiliate)  
- Event (webinar, conference)  
- Inbound call or email  

Storing source (and campaign) lets you later analyse which channels bring the most or best leads.

### 3.3 Lead lifecycle / stages

A lead moves through **stages** until they become a **customer** (or **lost**). A simple flow:

1. **New** – Just captured; not yet contacted.  
2. **Contacted** – Someone reached out (email, call).  
3. **Qualified** – Confirmed interest and fit (e.g. has budget, right profile).  
4. **Proposal / Offer sent** – Sent pricing, trial, or offer.  
5. **Negotiation** – In discussion (for B2B).  
6. **Converted** – Became a customer (signed up, paid).  
7. **Lost** – Not interested, unresponsive, or disqualified.

You can add sub-stages (e.g. “Contacted – no reply”, “Qualified – hot”) or keep it flat. The important part is that **status** is updated as the team works the lead.

### 3.4 Lead owner / assignment

- **Owner:** The user (or team) responsible for the lead.  
- **Assignment rules:**  
  - **Manual:** Admin picks an owner when creating or editing the lead.  
  - **Round-robin:** New leads are distributed in turn to a list of users.  
  - **By source or region:** e.g. “Leads from country X go to team Y”.  
  - **By score or type:** High-score leads to senior sales, rest to SDRs.

Assignment avoids “who follows up?” confusion and supports workload balance.

### 3.5 Lead scoring (optional)

**Lead scoring** assigns a number (e.g. 0–100) to indicate likelihood to convert. Points can be added for:

- **Explicit interest:** Downloaded guide, requested demo, visited pricing page.  
- **Fit:** Job title, company size, country (if you have rules).  
- **Engagement:** Opened emails, clicked links, multiple visits.

Points can be subtracted for bad fit or inactivity. High-score leads get priority or different assignment. Scoring can be manual (agent sets “Hot / Warm / Cold”) or rule-based (automated).

### 3.6 Conversion

When a lead **converts**, they become a **customer** (or **user** in your system). In practice:

- You link the **lead** record to the new **user** (or **account**) record.  
- Lead status is set to **Converted**.  
- You can store **conversion date** and **conversion source** (e.g. “Signed up via trial”, “Purchased challenge”).

That way you can report “converted leads” and attribute revenue to lead source/campaign.

---

## 4. Typical Features of a Leads Module

### 4.1 Capture

- **Forms:** Web forms (contact, demo request, download) that create a lead and optionally set source/campaign.  
- **API:** External systems (landing pages, ads, events) send lead data via API.  
- **Import:** CSV/Excel import with mapping (email, name, source, etc.).  
- **Manual:** “Add lead” in the admin UI with all fields.

### 4.2 Storage and list view

- **List (table) of leads** with columns: name, email, source, status, owner, created, last activity.  
- **Filters:** By status, source, owner, date range, score.  
- **Search:** By name, email, company.  
- **Sort:** By date, score, last activity.  
- **Pagination or infinite scroll** for large volumes.

### 4.3 Lead detail view

- **Single lead page (or drawer):** All contact info, source, status, owner, score, custom fields.  
- **Timeline / activity log:** Emails sent, calls logged, notes, status changes.  
- **Actions:** Change status, reassign owner, add note, schedule follow-up, convert to customer.

### 4.4 Qualification and status updates

- **Change status** (e.g. New → Contacted → Qualified).  
- **Add notes** (e.g. “Called, interested in $50K challenge”).  
- **Set next step:** “Call again on Friday”, “Send proposal”.  
- Optional **tasks / reminders** linked to the lead.

### 4.5 Assignment and ownership

- **Assign owner** when creating or editing a lead.  
- **Reassign** (e.g. hand off to another team member).  
- **Assignment rules** (round-robin, by source/region) for auto-assignment on create.  
- **Queue view:** “My leads” vs “Team leads” vs “Unassigned”.

### 4.6 Follow-up and activities

- **Log activity:** Call, email, meeting (with date and optional description).  
- **Send email** from the system (or log “Email sent externally”).  
- **Reminders:** “Follow up in 3 days” with a dashboard or list of due tasks.

### 4.7 Conversion to customer

- **“Convert” action** on a lead:  
  - Create (or link to) a **user** or **account**.  
  - Set lead status to Converted.  
  - Store conversion date and, if applicable, product/plan.  
- **Duplicate handling:** If a lead’s email already exists as a user, either link to that user or show a warning.

### 4.8 Reporting and metrics

- **Pipeline view:** Count of leads per status (funnel).  
- **Conversion rate:** Converted / Total leads (overall or by source).  
- **Time in stage / time to convert:** Average days from creation to conversion.  
- **By source:** Which source or campaign brings the most leads and the most conversions.  
- **By owner:** Performance per team member (optional).

---

## 5. Data Model (Sketch)

A minimal data model for a leads module could look like this. You can adapt it to your DB and product.

### 5.1 Tables (or entities)

**leads**

- `id` (PK)  
- `email` (unique or not, depending on your rules)  
- `name` (or first_name, last_name)  
- `phone` (optional)  
- `company` (optional, for B2B)  
- `source` (e.g. website, facebook_ad, referral)  
- `campaign` or `utm_campaign` (optional)  
- `status` (e.g. new, contacted, qualified, converted, lost)  
- `owner_id` (FK to users – the assignee)  
- `score` (optional, integer)  
- `custom_fields` (JSONB or separate columns)  
- `converted_user_id` (FK to users, set when converted)  
- `converted_at` (timestamp)  
- `created_at`, `updated_at`  
- Optional: `country`, `notes` (last note or summary)

**lead_activities** (or **lead_notes**)

- `id` (PK)  
- `lead_id` (FK)  
- `type` (e.g. note, call, email, status_change)  
- `content` or `description` (text)  
- `created_by` (FK to users)  
- `created_at`  
- Optional: `scheduled_follow_up_at`

**lead_sources** (optional, reference table)

- `id`, `name`, `slug` (e.g. website, facebook_ad)  
- Used for dropdowns and reporting.

**lead_statuses** (optional, reference table)

- `id`, `name`, `slug`, `order`  
- e.g. New, Contacted, Qualified, Converted, Lost.  
- Lets you add/rename statuses without code changes.

### 5.2 Relations

- One **lead** has one **owner** (user).  
- One **lead** has many **activities** (or notes).  
- One **lead** can be linked to one **user** after conversion (`converted_user_id`).

---

## 6. User Roles and Permissions

Typical permission ideas (names can match your existing system):

- **leads:view** – See lead list and detail.  
- **leads:create** – Add leads (manual or via form/API).  
- **leads:edit** – Edit lead data, status, owner.  
- **leads:delete** – Delete or archive leads (use sparingly).  
- **leads:assign** – Assign or reassign owner (might be same as edit).  
- **leads:convert** – Mark as converted and link to user.  
- **leads:export** – Export list to CSV.  
- **leads:view_reports** – Access pipeline and conversion reports.

You can also restrict by **ownership**: e.g. “see only my leads” vs “see all team leads” (scoping by `owner_id` or team).

---

## 7. How It Fits a Trading / Prop Platform

- **Trader leads:** People who signed up for a demo, downloaded a guide, or came from an ad. Pipeline: New → Contacted → Qualified → Signed up for challenge (converted).  
- **Affiliate leads:** Potential affiliates; pipeline could end with “Approved affiliate” (converted to affiliate account).  
- **B2B leads:** Brokers or partners; pipeline could include Proposal, Negotiation, then Converted (contract signed).

**Conversion** in your app would mean: create (or link) a **user** in your auth/users table and, if applicable, create a **challenge purchase** or **affiliate account**. The lead record stays for reporting (source, campaign, conversion date).

---

## 8. Integrations (When You Build It)

- **Forms:** Form backend (e.g. your API) creates a lead on submit; pass `source`, `utm_*` from the page.  
- **Ads:** Landing pages send lead + campaign parameters to your API.  
- **Chat:** When a chat conversation ends, optionally create a lead from the visitor’s email/name.  
- **Email / CRM:** Sync status or activities to an external CRM, or keep everything in your DB and use your UI as the “CRM”.

---

## 9. UI/UX Hints

- **List:** Dense table with filters and search; quick actions (Open, Change status, Assign).  
- **Detail:** One page or side panel with tabs: Info, Activity, History.  
- **Pipeline (Kanban):** Columns = statuses; cards = leads; drag-and-drop to change status.  
- **Dashboard:** Counts by status, conversion rate, “Leads due for follow-up today”.

---

## 10. Summary

| Concept | Meaning |
|--------|---------|
| **Lead** | A potential customer (contact + source + status + owner). |
| **Source** | Where the lead came from (form, ad, referral, etc.). |
| **Stage / status** | Step in the pipeline (New → Contacted → Qualified → Converted / Lost). |
| **Owner** | Person responsible for the lead; can be assigned manually or by rules. |
| **Scoring** | Optional numeric “likelihood to convert” (manual or rule-based). |
| **Activity** | Logged interactions: notes, calls, emails, status changes. |
| **Conversion** | Lead becomes a customer/user; link lead to user record and set status to Converted. |

A **leads management module** gives you one place to capture, assign, work, and convert leads, and to measure performance by source, campaign, and owner. When you add it later, you can start with a minimal version (list, detail, status, owner, convert) and then add scoring, activities, and reporting step by step.

---

*Document for future implementation. Adjust entity names, statuses, and permissions to match your platform.*
