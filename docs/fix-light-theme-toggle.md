# Light theme toggle (terminal) — implementation notes

## Summary

The terminal sidebar **Light Theme / Dark Theme** control now persists preference in `localStorage` (Zustand `persist`), toggles the **`dark` class on `<html>`** for Tailwind `darkMode: 'class'`, and applies theme **before the JS bundle** via an inline script in `index.html` to avoid a flash of the wrong mode.

Semantic colors are driven by **CSS variables** in `globals.css` (`html` / `html.dark`). Surfaces used with opacity utilities (`bg-surface-2/50`, `bg-background/95`, gradient `to-surface-2/30`, etc.) use **RGB triplets** (`--color-*-rgb`) in `tailwind.config.js` with Tailwind’s `rgb(var(...) / <alpha-value>)` pattern so those classes actually emit CSS (plain `var(--hex)` breaks `/opacity` in Tailwind).

## Files modified

| File | Change |
|------|--------|
| `tailwind.config.js` | `background`, `surface`, `surface-1`, `surface-2`, `muted` use `rgb(var(--color-*-rgb) / <alpha-value>)` for opacity-safe utilities; `border` and text colors stay on `var(--color-*)` where needed. |
| `src/shared/styles/globals.css` | Hex tokens + matching `--color-*-rgb` on `html` / `html.dark`; body, inputs, autofill, scrollbars, focus ring. |
| `index.html` | Inline boot script + no static `dark` on `<html>`. |
| `src/shared/store/themeStore.ts` | Zustand theme store + DOM class toggle. |
| `src/features/terminal/components/LeftSidebar.tsx` | Theme toggle + dual-mode chrome. |
| `src/features/terminal/layout/TerminalLayout.tsx` | Column dividers. |
| `src/features/terminal/components/RightTradingPanel.tsx` | Dual-mode panel chrome. |
| `src/features/terminal/components/ChartTopBar.tsx` | Empty-state bar border (main bar uses semantic surfaces). |
| `src/features/terminal/components/BottomDock.tsx` | Dock chrome, tables, overlays. |
| `src/features/terminal/components/ChartPlaceholder.tsx` | **Klinecharts** `setStyles('light' \| 'dark')` + light/dark grid/tooltip overrides; `useThemeStore` + effect to re-apply when theme or chart settings change. |
| `src/features/terminal/components/ChartTradingStrip.tsx` | Strip border/hover for light mode. |
| `src/features/terminal/components/TerminalAccountView.tsx` | Account mobile view gradient matches sidebar pattern. |
| `docs/feature-inventory.md` | §18.5 row. |
| `docs/fix-light-theme-toggle.md` | This document. |

**Unchanged:** `CenterWorkspace.tsx` — layout still `bg-background`; with RGB tokens, translucent layers now resolve correctly.

## Tailwind config

- **`darkMode: 'class'`** — already set; **no change** to that line.
- **Behavior note:** Theme is **explicit** (stored preference + class). We do **not** follow `prefers-color-scheme` automatically.

## Theme store API

```ts
import { useThemeStore } from '@/shared/store/themeStore'

// state
useThemeStore((s) => s.theme) // 'dark' | 'light'

useThemeStore.getState().setTheme('light')
useThemeStore.getState().toggleTheme()
```

- **Storage key:** `newpt-theme` (Zustand persist).
- **DOM:** Only the **`dark` class** on `document.documentElement` is toggled (Tailwind convention). No separate `light` class.

## Known light-mode gaps (backlog)

These are **expected** to need polish when the user is in light mode:

1. **Admin panel** — layouts, tables, sidebars, modals: many components still assume dark contrast; not audited.
2. **User panel** (`/user/*`) — same as admin.
3. **Auth / login** pages — not in scope.
4. **Terminal adjacent surfaces** — e.g. `TerminalMobileNav.tsx`, `ChatPanel.tsx`, `NotificationsPanel.tsx`, `SettingsPanel.tsx`, `TerminalHistoryView.tsx`, `TerminalPositionsView.tsx`, `SupportChatTab.tsx`, `TerminalSymbolsPage.tsx`, `TerminalMobileMenuPage.tsx`: may still mix `border-white/*` or fixed shadows; extend the same `slate` + `dark:` pattern as core terminal files.
5. **Global components** — `.scrollbar-modal`, `.table-scroll`, `.react-datepicker--dark`, `border-border/*` opacity on non-RGB tokens: tune for light or add RGB border tokens if needed.
6. **Third-party / portal UIs** — any fixed dark styling outside the token system.

## Manual test steps

1. Open the trading terminal → sidebar shows **Light Theme** (sun icon) when in dark mode.
2. Click **Light Theme** → UI switches to light tokens; label becomes **Dark Theme** (moon icon); `<html>` has **no** `dark` class.
3. Hard refresh → light mode **persists** without a full flash of dark chrome (boot script runs first).
4. Click **Dark Theme** → returns to dark; `dark` class on `<html>`.
5. Open **admin** or **user** panel in light mode → expect uneven contrast; tracked as polish backlog, not a regression blocker for this task.

## Verification

- `npx tsc --noEmit` — pass (run after changes).

## Light Mode Polish Pass 1 — Terminal Core

### Discovery (this pass)

- **CSS variables:** The app does **not** use classic shadcn `:root` / `.dark` HSL blocks in a separate `index.css`. Semantic colors live in **`src/shared/styles/globals.css`** on **`html`** (light) and **`html.dark`** (dark): `--color-background`, `--color-surface*`, `--color-text`, `--color-text-muted`, `--color-muted`, `--color-border`, plus matching **`-rgb`** triplets for Tailwind opacity utilities. Light `:root`-equivalent values are already defined on **`html`**; **`html.dark` was not modified** in this polish pass.
- **Hardcoded Tailwind:** Core chrome (`RightTradingPanel`, `BottomDock`, `LeftSidebar`, `ChartTopBar`, etc.) mixed **`text-muted`**, **`text-text-muted`**, **`border-white/*`**, and **`bg-slate-900`**-style classes without light bases, so light mode stayed low-contrast even when variables were correct.
- **Strategy:** **Mixed** — rely on existing **`html` / `html.dark`** tokens for `bg-background`, `bg-surface`, `text-text`, etc., and add explicit **`text-slate-*` + `dark:text-*`** (or `dark:text-muted` / `dark:text-text-muted`) everywhere secondary copy must stay readable on light surfaces. **Original dark appearance is preserved** by moving prior single-mode classes under **`dark:`** and adding a light base (never deleting the dark color).

### CSS variable changes (this pass)

- **None.** Only component class strings were updated; **`html.dark` block in `globals.css` unchanged.**

### Color mapping rules applied

- Backgrounds / borders / opacity whites: per user table (e.g. `bg-slate-50 dark:bg-slate-900`, `border-slate-200 dark:border-slate-700`, `bg-slate-900/5 dark:bg-white/5`, `border-slate-900/10 dark:border-white/10`).
- Muted labels: `text-slate-600` / `text-slate-600/80` / `text-slate-600/90` with **`dark:text-muted`** or **`dark:text-muted/80`** (or `dark:text-text-muted` where that was the prior semantic).
- **Accent / semantic:** `text-success`, `text-danger`, `text-accent`, buy/sell greens/reds, emerald/rose utility chains — **not changed.**

### Files modified (terminal polish)

| Area | Files |
|------|--------|
| Layout / workspace | `TerminalLayout.tsx`, `CenterWorkspace.tsx` |
| Side / order / dock | `LeftSidebar.tsx`, `RightTradingPanel.tsx`, `BottomDock.tsx` |
| Chart chrome | `ChartTopBar.tsx`, `ChartTradingStrip.tsx`, `PriceDisplay.tsx` |
| Chart-adjacent UI | `ChartPlaceholder.tsx`, `ChartSettingsModal.tsx`, `IndicatorParamsModal.tsx` |
| Mobile | `TerminalMobileNav.tsx` |
| Shared control | `src/shared/ui/Segmented.tsx` (order type tabs, etc.) |

*Other terminal files (e.g. `orders.api.ts`, `TerminalAccountView.tsx`) may show in `git diff` from parallel work; the theming pass focused on the table above.*

### Verified-fixed areas (screenshot checklist)

1. Right trading panel container — light surface + dark variant preserved.  
2. Section labels (ORDER TICKET, SYMBOL, ORDER TYPE, SIZE, Free Margin %, Leverage, COST BREAKDOWN) — slate bases + `dark:text-muted`.  
3. Symbol dropdown — input `bg-slate-100` + borders + `dark:` mirrors.  
4. LIVE QUOTE card — light gradient / border; bid/ask greens unchanged; dark gradient/shadow restored under `dark:`.  
5. Spread row — muted slate + `dark:text-muted/70`.  
6. Order type tabs — `Segmented` track + options light/dark split; selected accent unchanged.  
7. Size input — border/text/placeholder dual mode.  
8. Notional helper (`≈ … USDT`) — stronger slate + dark muted.  
9. Slider tick labels (`1%` … `100%`) — `text-slate-600/70 dark:text-muted/60`.  
10. Cost breakdown rows — label/value contrast with `dark:` preserved.  
11. Bottom dock account strip — labels/values and dividers (`divide-slate-200 dark:divide-white/10`).  
12–13. Position table headers and row text — header `text-slate-600/90 dark:text-muted/80`; LONG / P&amp;L colors unchanged.  
14. Dock tabs (POSITIONS / ORDERS / …) — inactive readable; selected accent unchanged.  
15. Close All / Columns / Export — icon/text hover states dual mode.  
16. Left sidebar balance — primary `text-text`; secondary lines `text-slate-*` + `dark:text-text-muted`; red P&amp;L unchanged.  
17. Symbol list rows — code, bid/ask, change % dual mode.  
18. Chart top bar timeframes / chart type — inactive `text-slate-600 dark:text-muted` + light hover surfaces.  
19. Footer clock / ping / RI PNL strip — slate + `dark:` for muted states.

### Known still-imperfect / backlog

- **Klinecharts `<canvas>`** — grid, axis, candle bodies: controlled by the chart library, not Tailwind; **follow-up** if light mode should fully lighten the plot area (may partially differ from `ChartPlaceholder` theme sync).  
- **`TerminalHistoryView.tsx`**, **`AiChatTab.tsx`**, and other **panels not in the core chrome list** — still contain bare `text-muted` / `hover:bg-white/10` patterns; polish when those surfaces are in scope.  
- **Admin / user / auth** — still out of scope per original brief.  
- **Spot-check** any newly added terminal components for `text-muted` without a `text-slate-*` base.

### Manual test steps (polish pass)

1. With **`dark` on `<html>`**, open terminal: confirm **no visual regression** vs pre-pass (panels, tables, LIVE QUOTE, cost breakdown, dock).  
2. Toggle **Light Theme**: right panel, left sidebar, chart **toolbar** (not necessarily canvas), bottom dock — all readable; buy/sell and P&amp;L colors match dark mode saturation.  
3. Exercise **Market/Limit**, symbol search, SL/TP accordion, leverage popover, dock tabs and **Close All** / **Columns** / **Export**.  
4. Run **`npx tsc --noEmit`** — expect pass.

### Dark mode unchanged (verification statement)

For every edited class string, the **previous dark-first color** remains as a **`dark:`** (or semantic `dark:text-muted` tied to `html.dark` CSS vars). **Removing** a dark color without a `dark:` replacement was avoided. **`html.dark` in `globals.css` was not edited.** Net: with `class="dark"` on `<html>`, the terminal should match the prior dark appearance; light mode gains explicit slate/light bases.
