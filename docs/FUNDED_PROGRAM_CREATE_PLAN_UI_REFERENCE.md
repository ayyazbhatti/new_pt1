# Funded Program – “Create a new plan” UI Reference

This document describes the **complete flow** of the “Create a new plan” UI as shown in the five reference screenshots. It covers every screen, field, and behavior so nothing is skipped.

---

## Overview

The flow is a **multi-step wizard** (modal or full page) used by admins to create a new **plan** for a funded trading program. A plan defines:

1. **Payment tiers** – What users pay and what account size they get (Pay / Get).
2. **Retry rules** – Whether users can retry after failure, at what discount, and with what limits.
3. **Challenge conditions** – Evaluation rules per phase (daily loss, overall loss, profit target, duration, etc.).
4. **Add-ons** – Optional paid or free extras (faster payouts, profit booster, weekend hold, leverage).
5. **Challenge Keeper** – Linking conditions to each phase and package (e.g. which “Max Daily Loss” applies to Phase 01 for the $25K package).

The wizard has **four main steps** indicated by a progress indicator at the top. Some screens also show **phase tabs** (Phase 01 – Audition, Phase 02 – Audition, Phase 03 – Funded) for phase-specific configuration.

---

## Screenshot 1 – Step 1: Plan basics, Pay/Get, and Retry Settings

**Screen title:** Create a new plan  
**Progress:** Step 1 of 4 (first step active – blue circle).  
**Purpose:** Define payment tiers (Pay / Get), then configure retry behaviour (plan retry, discount, expiration, limits).

### Header / Navigation

- **Top left:** Flag icon (e.g. “Plans” or “Programs”).
- **Top center:** Progress indicator with four steps; step 1 is active.
- **Top right:** Close (X) to cancel or close the modal.

### Section: Payment and “Get” (account size)

- **Title / context:** This section defines the core economics of the plan: how much the user **pays** and what account size they **get** (simulated/funded size).
- **Pay / Get pairs:** Two pairs are shown:
  - **Pay $100** → **Get $25,000**
  - **Pay $200** → **Get $50,000**
- **Per pair, three icons:**
  - **Star** – Mark as favorite / highlight.
  - **Fire** – Mark as popular / “hot”.
  - **Trash** – Delete this Pay/Get option.
- **Button:** **“Add Account Size”** – Add another Pay/Get tier (e.g. Pay $300 / Get $75,000). So a single plan can have **multiple account sizes** (multiple packages in one plan).

### Section: Retry Settings

- **Plan Retry (toggle):**  
  - **On (green):** Enables “plan retry” for this plan.  
  - **Description:** “Allows traders to buy the same plan again at a discount. Failed retries cannot be retried.”  
  - So: first attempt can be retried at a discount; if that retry fails, no further retry for that purchase.

- **Discount Settings**
  - **Dropdown:** Set to **“Custom”** (other options might be presets like “10% off”, “Fixed price”, etc.).
  - **Discount Amount\*:** **% 20** – 20% discount for a retry. Has **+ / −** buttons to adjust. Required (\*).
  - **“Set to Fixed Price” (checkbox):** Unchecked here – discount is percentage-based. If checked, discount could be a fixed dollar amount instead of a percentage.
  - **Discount Source Price\*:** **“Original Price”** – The discount is applied to the original plan price. Other options might be “Current price” or similar.

- **Expiration Time (Days since failure)\*:** **7**  
  - Retry is only available for **7 days** after the failure. Adjustable with + / −. Required (\*).

- **Total Retries by Purchase\*:** **4**  
  - Maximum number of **retries** a user can buy for **one** original purchase (e.g. up to 4 retries at 20% off within 7 days of each failure). Required (\*).

### Footer actions

- **“Segev’s screen”** – Greyed/placeholder (e.g. dev or internal view).
- **Cancel** – Discard and close.
- **“Next: Conditions”** – Go to **Step 2: Challenge conditions**.

---

## Screenshot 2 – Step 2: Challenge conditions (per phase)

**Screen title:** Create a new plan  
**Progress:** Phase 01 – Audition (done, checkmark), **Phase 02 – Audition** (active, blue dot), Phase 03 – Funded (greyed).  
**Purpose:** Set evaluation rules for the challenge: daily loss, overall loss, profit target, duration, min trading days, etc. These are the “conditions” that define pass/fail for each phase.

### Navigation

- Same header and close (X).
- **Phase tabs:** Phase 01 – Audition | Phase 02 – Audition | Phase 03 – Funded. Phase 02 is selected, so the form below applies to **Phase 02**.

### Section: Challenge conditions (fields)

Each field has an **info icon (ⓘ)** for tooltips. Values below are as in the screenshot.

| Field | Value / state | Notes |
|-------|----------------|--------|
| **Max Daily Loss** | `%-5` | Daily loss limit: 5%. + / − to adjust. |
| **Max Overall Loss** | `%-10` | Maximum total drawdown: 10%. + / − to adjust. |
| **Minimum Trading Days** | (empty) | Checkbox **“Disable Minimum Trading Days”** is **checked** – no minimum trading days for this phase. |
| **Challenge Duration** | `30` | Challenge lasts 30 days. + / − to adjust. Checkbox **“Set unlimited days”** is **unchecked** – duration is limited. |
| **Profit Target** | `%10` | Must reach 10% profit. + / − to adjust. **“No Profit Target”** is **unchecked** – profit target is required. |
| **Max Daily Profit** | (empty) | Checkbox **“Disable Max Daily Profit”** is **checked** – no cap on daily profit. |
| **Promo Code** | Dropdown: **“No promo code.”** | Optional promo for this plan/phase. |
| **Challenge Leverage** | Dropdown: **“System Default”** | Leverage for this challenge (or use system default). |

So for **Phase 02 – Audition** the rules are: 10% profit target, 5% max daily loss, 10% max overall loss, 30 days, no min trading days, no max daily profit.

### Footer actions

- **Back** – Return to Step 1 (Pay/Get and Retry).
- **“Next: Add-ons”** – Go to **Step 3: Add-ons**.

---

## Screenshot 3 – Step 3: Add-ons

**Screen title:** Create a new plan  
**Progress:** Step 3 of 4 active.  
**Purpose:** Enable and configure **add-ons** (optional features) for the plan: faster payouts, higher profit share, weekend hold, double leverage.

### Section: Add-ons (list)

Each add-on has a **toggle** (on/off) and optionally **configuration fields** when on.

1. **Payout Express** – **ON (green)**  
   - **Description:** “Enables faster payouts on funded accounts based on the specified number of days.”  
   - **# of Days:** `2` (payout in 2 days). + / − and info icon.  
   - **Price:** `$ 20.00`. + / − and info icon.  
   - **“Set to Fixed Price”:** Checked – price is a fixed $20, not percentage.

2. **Profit Booster** – **OFF (grey)**  
   - **Description:** “Enables higher profit share to the trader.”

3. **Hold Over Weekend** – **OFF**  
   - **Description:** “Allows the trader to hold the open positions over the weekend.”

4. **Double Leverage** – **OFF**  
   - Description is partially cut off but refers to enabling double leverage.

### Footer actions

- **Back** – Return to Step 2 (Conditions).
- **“Next: Challenge Keeper”** – Go to **Step 4: Challenge Keeper Settings**.

---

## Screenshot 4 – Step 4: Challenge Keeper Settings (overview)

**Screen title:** Challenge Keeper Settings  
**Progress:** First three steps done (checkmarks), **Step 4** active (blue circle).  
**Purpose:** Turn the “Challenge Keeper” on/off, choose account size, choose **phase**, and **select which conditions** apply to each plan/package and phase. This is where “conditions” (e.g. Max Daily Loss, Max Overall Loss) are **assigned** to each combination of package and phase.

### Header

- Flag icon, progress (4 steps, step 4 active), Close (X).

### Section: Challenge Keeper Settings

- **Keeper Status:** **Active** (green toggle). Enables or disables the Challenge Keeper for this plan.

- **Account Size:** A control showing **“$25K”** – the account size (package) being configured. Likely a dropdown or button to pick which Pay/Get tier (e.g. $25K, $50K) this keeper config applies to.

- **Challenge Types (tabs):**
  - **Phase 01 – Audition** (selected in this screenshot).
  - **Phase 02 – Audition**.
  - **Phase 03 – Funded.**  
  So conditions are configured **per phase**.

- **Select Conditions:**
  - Search input (magnifying glass) to find conditions.
  - **Instruction:** “You need to select a condition for each plan by package and type.”  
  So the admin must attach at least one condition (e.g. Max Daily Loss, Max Overall Loss) to **each** (package × phase) combination.

### Footer actions

- **Back** – Return to Step 3 (Add-ons).
- **“Save Plan”** – Save the full plan (all four steps).

---

## Screenshot 5 – Step 4: Configuring a condition (Max Daily Loss)

**Screen title:** Challenge Keeper Settings  
**Progress:** Same as Screenshot 4 (step 4 active).  
**Purpose:** **Edit a specific condition** (here: Max Daily Loss) for the selected phase and package – set alert type, threshold, notifications, new value, and price-related options.

### Phase and condition selection

- **Phase 01 – Audition** tab is active.
- **Select Conditions:** Search shows **“Max Daily Loss X”** – “Max Daily Loss” is selected; “X” removes it.
- **List of conditions:**
  - **Max Daily Loss** – selected (blue checkmark).
  - **Max Overall Loss** – available to select.

So the user is **configuring the “Max Daily Loss” condition** for **Phase 01 – Audition** (and implicitly for the chosen account size, e.g. $25K).

### Section: Max Daily Loss configuration

All fields have an info icon (ⓘ).

| Field | Value / meaning |
|-------|------------------|
| **Alert Type** | Dropdown: **“Fixed Percentage.”** (Other options might be “Fixed amount”, etc.) |
| **Alert Threshold** | Input with **“%”** – percentage at which an alert is raised. |
| **Login Alerts Notification (By Device)** | `2` – number of devices that can receive login/alert notifications. |
| **New Condition Value** | **% -7** – the new daily loss limit for this condition. Note below: “Current Max Daily Loss value is -5%.” So the user is changing Phase 01’s max daily loss from -5% to -7%. |
| **Price Type** | **“Original Price”** – how the “price” of this condition is calculated (e.g. relative to original plan price). |
| **Purchase Price** | Input with **“%”**. Note: “Current account size price is 100$.” So the condition can have a price (e.g. percentage of the $100 plan price). |

So in Challenge Keeper you can:

- **Select** which conditions apply to which phase (and package).
- **Per condition:** set alert type, threshold, notifications, **new value** (e.g. -7% for Max Daily Loss), and price type/purchase price.

### Footer actions

- **Back** – Return to previous view (e.g. condition list or Step 3).
- **“Save Plan”** – Save the plan and the condition configuration.

---

## How the full flow works (end-to-end)

1. **Step 1 – Plan basics**
   - Add one or more **Pay / Get** pairs (e.g. $100 → $25K, $200 → $50K). Optionally mark some as favorite or popular; delete if needed.
   - Enable **Plan Retry** and set: discount (e.g. 20% from original price), expiration (e.g. 7 days after failure), max retries per purchase (e.g. 4).
   - **Next: Conditions.**

2. **Step 2 – Challenge conditions**
   - For **Phase 01** and **Phase 02** (Audition) and **Phase 03** (Funded), set:
     - Max Daily Loss, Max Overall Loss, Profit Target, Challenge Duration, Minimum Trading Days, Max Daily Profit (or disable some).
     - Promo code and Challenge Leverage if needed.
   - **Next: Add-ons.**

3. **Step 3 – Add-ons**
   - Turn on/off: **Payout Express** (faster payouts; e.g. 2 days, $20), **Profit Booster**, **Hold Over Weekend**, **Double Leverage**. Configure each when enabled.
   - **Next: Challenge Keeper.**

4. **Step 4 – Challenge Keeper**
   - Enable **Challenge Keeper** and choose **account size** (e.g. $25K).
   - For **each phase** (Phase 01, 02, 03), **select conditions** (e.g. Max Daily Loss, Max Overall Loss) and optionally **refine** them (e.g. change Max Daily Loss from -5% to -7%, set alert type, threshold, price).
   - **Save Plan** to persist the whole plan.

Result: a **plan** that has multiple account sizes (Pay/Get), retry rules, phase-specific evaluation rules (conditions), add-ons, and a Challenge Keeper that ties conditions to each package and phase. This matches the idea that “exact targets and limits depend on the package and phase” and that the UI supports multiple phases (Audition 01, Audition 02, Funded) and optional extras (payout express, profit booster, etc.).

---

## Summary table (all 5 screens)

| # | Screen | Main purpose |
|---|--------|----------------|
| 1 | Create a new plan – Step 1 | Pay/Get tiers; Plan Retry (discount, expiration, retry limit). |
| 2 | Create a new plan – Conditions | Per-phase rules: max daily/overall loss, profit target, duration, min days, max daily profit, leverage, promo. |
| 3 | Create a new plan – Add-ons | Payout Express, Profit Booster, Hold Over Weekend, Double Leverage (on/off + config). |
| 4 | Challenge Keeper Settings | Keeper on/off; account size; phase tabs; “Select conditions” per plan/package and type. |
| 5 | Challenge Keeper – Condition config | Edit one condition (e.g. Max Daily Loss): alert type, threshold, new value, price type, purchase price. |

---

*Document generated from the five reference screenshots of the “Create a new plan” / Challenge Keeper UI. Use this as the single reference for the full flow and all fields; nothing from the screenshots is omitted.*
