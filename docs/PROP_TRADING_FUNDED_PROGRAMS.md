# Prop Trading & Funded Trader Programs – Complete Overview

This document describes how **prop (proprietary) trading** and **funded trader / challenge programs** work: packages, challenges, targets, fees, and rewards. Use it as a reference for product design, requirements, or implementation.

---

## 1. What It Is

**Prop trading** (in this context) means a **company** (the “prop firm”) provides **trading capital** to traders. Traders do not risk their own money for that capital; they follow the firm’s rules. If they pass **evaluation challenges**, they get **funded** and earn a **share of the profits** they make. Traders typically **pay a fee** to participate in the challenge.

In short:

- **Packages** = account size (e.g. $10k, $50k) and associated fee.
- **Targets** = profit goals (e.g. 8% in Phase 1, 5% in Phase 2).
- **Challenges** = one or two evaluation phases with those targets and risk rules.
- **Fee** = what the user pays to join the challenge for a given package.
- **Rewards** = profit split (e.g. 80% to trader) when funded, paid on a schedule.

---

## 2. Packages (Account Sizes & Tiers)

### 2.1 Definition

A **package** is a product that defines:

- **Account size** (e.g. $10,000, $25,000, $50,000, $100,000, $200,000).
- **Entry fee** (one-time or subscription) the user pays to attempt the challenge for that size.
- Optionally: **tier** (e.g. Starter, Pro, Elite) affecting rules or profit split.

### 2.2 Typical Package Structure

| Package name   | Account size | Fee (example) | Notes        |
|----------------|-------------|----------------|--------------|
| Starter       | $10,000     | $99            | Entry level  |
| Basic         | $25,000     | $199           |              |
| Standard      | $50,000     | $249           | Popular      |
| Pro           | $100,000    | $499           |              |
| Elite         | $200,000    | $999           | Higher split |

Firms may offer:

- **Discounts** (e.g. first challenge 50% off, or bundle 2 phases).
- **Free retries** or discounted retry if the user fails on a technicality.
- **Subscription** (e.g. monthly) instead of one-time fee.

### 2.3 What the User Gets for the Fee

- Access to a **simulated/demo** account of that size for the challenge.
- If they pass all phases: transition to a **funded** account (often real capital or higher-tier sim) and eligibility for **profit payouts**.

---

## 3. Challenges & Phases

### 3.1 Overview

Most prop firms use a **two-phase challenge**; some use a single phase.

- **Phase 1** – First evaluation (e.g. “Challenge”).
- **Phase 2** – Second evaluation (e.g. “Verification” or “Funded Trial”).
- Pass both → **Funded** status and profit share.

### 3.2 Phase 1 (Challenge)

- **Account**: Sim/demo account with the package’s account size.
- **Profit target**: Reach a defined % (e.g. **8% or 10%**) within a **time limit** (e.g. **30 days**).
- **Risk rules**: Must not breach:
  - Daily loss limit (e.g. 5% of starting balance).
  - Maximum total loss / max drawdown (e.g. 10% from start or from peak).
  - Any other rules (leverage, instruments, min trading days, etc.).
- **Outcome**:
  - Target hit + no rule breach → **Pass** → move to Phase 2.
  - Rule breached or time expired without target → **Fail** → user may retry (new fee or retry offer).

### 3.3 Phase 2 (Verification / Funded Trial)

- **Account**: New sim (or sometimes extended) account, same or slightly different rules.
- **Profit target**: Often **lower** (e.g. **5%**) over a **longer** window (e.g. **60 days**).
- **Risk rules**: Same as Phase 1 (daily loss %, max drawdown %, etc.).
- **Outcome**:
  - Target hit + no rule breach → **Funded**.
  - Otherwise → **Fail**; user may buy again or use retry if offered.

### 3.4 Single-Phase Variant

Some firms use **one phase** only: hit target and respect rules once, then get funded. Shorter path, often with slightly stricter or different rules.

---

## 4. Rules (Pass vs Fail)

### 4.1 Core Rule Types

| Rule                 | Description | Example |
|----------------------|------------|---------|
| **Profit target**    | Must reach X% profit in the phase. | 8% in 30 days (Phase 1), 5% in 60 days (Phase 2). |
| **Daily loss limit** | If day’s loss reaches Y% of (starting balance or day start), account fails. | 5% daily loss limit. |
| **Max total loss**   | Total drawdown from start (or from peak) must not exceed Z%. | 10% max drawdown. |
| **Max calendar days**| Phase must be completed within a fixed period. | 30 days for Phase 1. |
| **Min trading days** | Some require a minimum number of days with at least one trade. | e.g. 5 trading days. |
| **Leverage / position size** | Caps on position size or leverage. | Max 2% risk per trade, or max lot size. |
| **Instruments**      | Allowed symbols (forex, indices, commodities; sometimes no exotics). | FX majors + indices only. |
| **Weekend / overnight** | Some forbid holding over weekend or certain times. | No positions over Sunday open. |

### 4.2 How Rules Are Applied

- **Real-time**: Balance, equity, daily P&L, and drawdown are monitored continuously (e.g. per tick or per order).
- **Breach** of any rule → account **failed** for that phase; no refund of fee unless the firm offers a retry/refund policy.
- **Pass** = target met and no breach before the end of the phase.

### 4.3 Typical Values (Examples Only)

| Parameter        | Phase 1   | Phase 2   |
|------------------|-----------|-----------|
| Profit target    | 8–10%     | 5%        |
| Daily loss limit | 5%        | 5%        |
| Max drawdown     | 10%       | 10%       |
| Calendar days    | 30        | 60        |
| Min trading days | 0–5       | 0–5       |

These vary by firm and package.

---

## 5. Fee (What the User Pays)

### 5.1 Purpose

- User **pays once per challenge** (or per retry) or via **subscription**.
- Fee is tied to the **package** (account size and tier).
- Covers cost of running evaluations and (for the firm) revenue from participants who do not pass.

### 5.2 Common Practices

- **One-time fee** per challenge attempt.
- **Discounts**: first challenge 50% off, or “buy Phase 1 + Phase 2” bundle.
- **Free retry**: one free retry if failed (e.g. due to a minor rule or bug).
- **Subscription**: monthly fee for access to challenges or to keep a funded account.

### 5.3 Refunds

- Most firms **do not refund** if the user fails (it’s the cost of participation).
- Some offer **refund on first payout** (fee refunded when you make your first profit withdrawal).

---

## 6. Rewards (When Funded)

### 6.1 Profit Split

- Trader keeps a **percentage** of profits; the firm keeps the rest.
- Common splits: **80% trader / 20% firm**, or **90/10**, **70/30**, depending on package/tier.

### 6.2 Payout Schedule

- **First payout**: Often after a **minimum period** (e.g. 14 days) and sometimes a **minimum profit**.
- **Ongoing**: **Bi-weekly** or **monthly** (e.g. 1st and 15th, or end of month).
- **Processing**: Bank transfer, PayPal, crypto, etc., per firm’s policy.

### 6.3 Caps and Conditions

- **Max withdrawal per payout** (e.g. $10,000 per request).
- **Max total payout** per month.
- **Scaling**: Some firms offer a **size increase** after consistent performance (e.g. from $100k to $200k funded size).

### 6.4 Funded Account Failure

- Same **risk rules** (daily loss, max drawdown) usually apply on the funded account.
- Breach → **loss of funded status**; no further payouts for that account; user may need to buy a new challenge to try again.

---

## 7. Business Model (Why Firms Run This)

### 7.1 Revenue

- **Challenge fees**: Many participants do not pass Phase 1 or Phase 2, so the firm keeps the fee without paying profit share.
- **Ongoing fees**: Subscriptions or recurring fees for challenges or account access.

### 7.2 Costs

- **Profit share** paid to funded traders.
- **Platform**, support, compliance, and (if live) capital and risk management.

### 7.3 Risk Management

- **Strict rules** (daily loss, max drawdown) limit how much a funded trader can lose.
- Firm may use **sim** for “funded” initially and switch to **live** only for proven traders, or keep some accounts on sim.

---

## 8. End-to-End User Journey (Summary)

1. **Choose package** → Select account size (e.g. $50k) and see fee (e.g. $249).
2. **Pay fee** → Complete payment for one challenge attempt (or subscription).
3. **Phase 1** → Trade sim account; aim for e.g. 8% in 30 days without breaching daily/max loss.
4. **Pass Phase 1** → Unlock Phase 2.
5. **Phase 2** → Trade second sim; aim for e.g. 5% in 60 days with same risk rules.
6. **Pass Phase 2** → **Funded**.
7. **Trade funded account** → Same risk rules; profits subject to split (e.g. 80/20).
8. **Request payout** → According to schedule and limits; receive reward (e.g. 80% of profits).
9. **If rule breached** → Lose funded status; may purchase a new challenge to try again.

---

## 9. Summary Table

| Term        | Meaning |
|------------|--------|
| **Package**| Account size (e.g. $10k–$200k) + entry fee; optionally tier. |
| **Target** | Profit % to reach in a phase (e.g. 8% then 5%). |
| **Challenge** | One or two evaluation phases with targets and risk rules. |
| **Fee**    | What the user pays to participate in the challenge for that package. |
| **Rewards**| Profit split (e.g. 80/20) when funded; paid on a defined schedule. |
| **Funded** | Status after passing all phases; trader is eligible for profit share. |

---

## 10. Possible Extensions (For Product Design)

- **Multiple account sizes per user** (e.g. one $10k and one $50k challenge).
- **Leaderboards** (e.g. by profit %, time to target) – can be gamified.
- **Referrals** (discount or free retry for referred users).
- **Custom rules per package** (e.g. stricter daily loss for larger sizes).
- **Trading restrictions** (news time, symbols, max lot size) encoded as rules.
- **Reporting** for user (progress %, days left, distance to target and to risk limits).

---

If you want to change or add anything (e.g. your own package names, exact rule numbers, or platform-specific flows), say what to update and we can refine this document.
