# Phase 2 — Lot size: investigation (`SHOW_ONLY_UNITS_SIZE_MODE`)

## Step 1 — Git history / blame

### `git log -p -S "SHOW_ONLY_UNITS_SIZE_MODE"`

The constant was **introduced as `true`** in a single commit; it was **not** flipped from `false` to `true` in a later change.

| Field | Value |
|--------|--------|
| **Commit** | `2e70629de48b14e86829c085140f45fbda3c337f` |
| **Author** | Muhammad Ayyaz Bhatti |
| **Date** | Mon Mar 16 14:39:02 2026 +0500 |
| **Subject** | `Order-engine: JetStream acks, tick fallback; deploy scripts; Docker log limits; migrations & UI updates` |

**Introduced diff (abridged):**

- Added comment: `When true, only Units size mode is shown; Lots and Pip Position are hidden (set to false to show them again).`
- `const SHOW_ONLY_UNITS_SIZE_MODE = true`
- Wrapped the Size Mode `Segmented` in `{!SHOW_ONLY_UNITS_SIZE_MODE && ( ... )}`
- Gated Lots / Pip inputs with `!SHOW_ONLY_UNITS_SIZE_MODE && sizeMode === 'lots'|'pipPosition'`
- **`handlePlaceOrder`:** `effectiveSizeMode = SHOW_ONLY_UNITS_SIZE_MODE ? 'units' : sizeMode` so submission always uses units when the flag is true.
- Same `effectiveSizeMode` for post-submit market reset.

**Conclusion:** The flag first appeared **as `true`**, bundled into a **large multi-area commit** (order-engine, deploy, terminal, WS). The message does **not** cite a specific lots-mode bug.

### `git blame` (lines 50–51)

- Comment + `SHOW_ONLY_UNITS_SIZE_MODE = true` → **`2e70629d`** (2026-03-16).

### Related follow-up: `77824512` (2026-05-14)

`Dev: Postgres 5434, WS gateway resilience, BottomDock loading` **did not change** the flag value (it stayed `true`) but:

- Removed the **Free Margin % slider** and `handleFreeMarginSliderChange` (that handler had **forced `setSizeMode('units')`** on every slider move — lots + slider would have been inconsistent).
- Added **`MIN_EST_MARGIN_DOLLARS`**, `getDefaultSizeForMinMargin`, and an **auto-seed `useEffect`** that only runs when  
  `SHOW_ONLY_UNITS_SIZE_MODE || sizeMode === 'units'`  
  i.e. today it effectively assumes **units-only** for seeding minimum estimated margin.

So re-enabling lots requires **extending auto-seed** to populate `lotSize` / `pipPosition` when those modes are active, not only `size`.

---

## Step 2 — Broader grep (docs / comments)

Commands used (conceptually): `lots mode`, `lot size`, `TODO.*lots`, `docs` grep for `SHOW_ONLY_UNITS` / `size mode`.

- **No** dedicated doc in-repo explaining a broken lots path.
- No `TODO`/`FIXME` tied to lots in `RightTradingPanel` beyond the inline “set to false to show them again” comment on the flag.

---

## Step 3 — Docs directory

No `docs/*.md` file references `SHOW_ONLY_UNITS_SIZE_MODE` or “size mode” disable by name. Slippage / market-sessions docs do not cover this flag.

---

## Step 4 — Lots input flow (code trace, no fix)

1. **Lots input:** `onChange` updates `lotSize` state. `sizeCalculations` uses `normalizeLotSize` + `calculateUnitsFromLots` for `currentUnits` when `sizeMode === 'lots'`. Margin estimate uses `sizeCalculations.currentUnits` — **correct**, independent of `symbolLeverage` for the units conversion itself (tiers only in `getDefaultSizeForMinMargin` / leverage display).

2. **`handlePlaceOrder`:** With flag off, uses `sizeMode` directly; lots branch calls `normalizeLotSize` → `calculateUnitsFromLots` — **consistent** with `sizeCalculations`.

3. **`handleSizeModeChange`:** Converts using current `sizeCalculations` and updates `size` / `lotSize` / `pipPosition` before `setSizeMode` — **reasonable** for preserving economic size across modes.

4. **Code smell / integration risk:** Auto-seed and min-margin UX were written under **`SHOW_ONLY_UNITS_SIZE_MODE || sizeMode === 'units'`**. Re-enabling lots **without** extending that effect leaves FX in **lots** mode with a **stale default `lotSize`** (e.g. `0.5` from localStorage) vs the new min-margin target — **not** a fundamental conversion bug, but a **product/QA** gap to close in the same change.

---

## Step 5 — Verdict

### **Category A**

The flag was added in a **bulk terminal commit** with a **developer toggle** comment, not a referenced defect ID or test removal. The old **free-margin slider** always forced **units** mode; that slider is gone (`77824512`), so the original “mode fights slider” tension is reduced. No evidence of a **specific broken lots formula** in git history.

**Caveat (lightweight “B-style” follow-up in the same PR):** extend **auto-seed** so min-margin defaults apply in **lots** and **pip** modes too (derive from the same `getDefaultSizeForMinMargin` base-units target).

---

## Step 6+ — Fix applied (summary)

See `RightTradingPanel.tsx`:

- Removed `SHOW_ONLY_UNITS_SIZE_MODE` and all gating; `handlePlaceOrder` and the market-order post-submit reset use `sizeMode` only.
- Added `getDefaultSizeModeForSymbol(terminalSymbol, adminSymbol)` (FX / contract-style → lots; otherwise units).
- **Explicit preference flag:** `sizeModeUserExplicit` in `localStorage` (`TradingPanelState`). It is set to `true` only when the user changes the Size Mode `Segmented` control. Initial `sizeMode` uses persisted mode **only if** that flag is true; otherwise the symbol default applies. This avoids treating “we autosaved `sizeMode` on every keystroke” as a permanent user override (which would block EURUSD → lots after revisit).
- `useEffect` on symbol (+ admin metadata) snaps default mode when `!sizeModeUserExplicit`.
- Auto-seed effect: seeds `size`, `lotSize`, or `pipPosition` from `getDefaultSizeForMinMargin()` via `defaultSizeStringToBaseUnits` + lot/pip conversion; `seedKey` includes `sizeMode` so symbol/mode/order-context changes re-seed. Comment references this doc.

**Reference:** this file (`docs/phase-2-lot-size-investigation.md`).

**Verification:** `npx tsc --noEmit` and `npx vitest run` pass.
