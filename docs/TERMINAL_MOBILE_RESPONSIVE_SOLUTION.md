# User Terminal Panel — Mobile-Responsive Solution

**Status:** Validated against codebase (TerminalLayout, AppShellTerminal, LeftSidebar, CenterWorkspace, RightTradingPanel, BottomDock, terminalStore). Chart library confirmed as **klinecharts**. This plan is implementation-ready pending stakeholder approval.

---

## 1. Objective

Make the **user trading terminal** responsive so it works and feels like a **mobile app** on phones and small tablets: single-column layout, touch-friendly controls, and clear navigation between Chart, Trade, Positions, and Account without relying on the current three-column desktop layout.

---

## 2. Current Architecture (Summary)

| Layer | Component | Role |
|-------|-----------|------|
| **Page** | `TerminalPage` → `AppShellTerminal` | Wraps layout and passes left/center/right/rightPanel |
| **Layout** | `TerminalLayout` | Fixed grid: `grid-cols-[224px_1fr_288px]` (left 224px, center flex, right 288px). Full viewport, no breakpoints. |
| **Left** | `LeftSidebar` | User row, balance/equity/margin, search, All/Watchlist tabs, symbol list, Deposit/Withdraw, Settings/Logout. ~224px fixed width. |
| **Center** | `CenterWorkspace` | Chart top bar (type, timeframe, indicators, drawings, fullscreen), chart area, then `BottomDock` (positions/orders/history tabs + tables). |
| **Right** | `RightTradingPanel` | Symbol header, order type/size/margin/SL-TP, Buy/Sell, internal tabs (Trade / Positions / Market / History). Overlay panels (Notifications, Chat, Payment, Settings) slide in from right. |
| **Overlays** | NotificationsPanel, ChatPanel, PaymentPanel, SettingsPanel | Rendered inside right column as absolute overlay; toggled from LeftSidebar icons. |

**Current constraints**

- No responsive breakpoints: layout is desktop-only.
- Fixed pixel columns: left 224px, right 288px — unusable on narrow viewports.
- Dense controls: chart toolbar, trading form, and tables assume mouse/hover and large screens.
- No mobile navigation pattern: no bottom nav or tab bar to switch between Chart / Trade / Positions / Account.

---

## 3. Design Goals (Mobile-App-Like)

1. **Single primary view per screen** on small viewports (e.g. Chart **or** Trade **or** Positions **or** Account), with explicit navigation (e.g. bottom tab bar or top tabs).
2. **Touch-friendly**: minimum ~44px tap targets, adequate spacing, no hover-only actions.
3. **Readable and scannable**: font sizes and contrast suitable for small screens; key info (price, balance, PnL) prominent.
4. **Progressive disclosure**: secondary content (symbol list, settings, notifications) in drawers/sheets/modals instead of always-visible sidebars.
5. **Safe areas**: respect `env(safe-area-inset-*)` for notches and home indicators.
6. **Optional PWA/standalone**: meta tags and display mode so the terminal can be “installed” and feel like a native app (separate from layout changes).

---

## 4. Recommended Breakpoints

Use Tailwind’s default breakpoints (no theme override unless needed):

| Breakpoint | Min width | Usage |
|------------|-----------|--------|
| (default) | &lt; 640px | **Mobile**: single column, bottom nav, drawers/sheets. |
| `sm` | 640px | **Large phone / small tablet**: still single-column or simplified two-column. |
| `md` | 768px | **Tablet**: optional two-column (e.g. chart + trade side-by-side). |
| `lg` | 1024px | **Desktop**: current three-column layout (left sidebar + center + right panel). |

**Strategy**: **Mobile-first**. Default styles target small screens; `md:` and `lg:` add the current desktop layout. Below `lg`, treat the terminal as “app mode” with a single main area and navigation to other sections.

---

## 5. Layout Strategy by Breakpoint

### 5.1 Mobile / small tablet (&lt; 1024px) — “App mode”

- **Single main area** filling the viewport. Only one of these is visible at a time as the “main” content:
  - **Chart** (chart + minimal top bar; bottom dock can be a smaller bar or hidden by default).
  - **Trade** (order form: symbol, side, size, SL/TP, Buy/Sell).
  - **Positions** (list/cards of open positions; optional orders list).
  - **Account** (balance, equity, margin, deposit/withdraw, settings, logout).

- **Navigation**
  - **Bottom tab bar** (recommended): 4–5 items — e.g. Chart | Trade | Positions | Account (and optionally More for Notifications/Chat/Settings). Active tab shows the corresponding view. Matches common mobile trading apps.
  - **Alternative**: Top tab bar (Chart / Trade / Positions) + hamburger or profile icon for Account and overlays.

- **Left sidebar (symbol list, balance, search)**
  - **Not** rendered as a fixed column. Expose via:
    - **Symbol selector** in the top bar (or in Trade view): tap opens a **bottom sheet** or **full-screen modal** with search and symbol list (reuse `LeftSidebar` symbol list or a simplified component).
  - **Balance / equity** can appear in the top bar (compact) and/or in the **Account** tab.

- **Right trading panel**
  - **Trade** tab content = current order form from `RightTradingPanel` (simplified if needed: market order, size, Buy/Sell; SL/TP in expandable section).
  - **Positions** tab = positions list (and optionally orders). Can reuse/adapt `BottomDock` content or a mobile-optimized list (cards instead of wide table).

- **Center (chart)**
  - **Chart** tab = chart full width, minimal top bar (symbol, timeframe, fullscreen). Drawing tools can be in a secondary toolbar or “more” menu to avoid clutter.
  - **BottomDock** (positions/orders tables): on mobile, either hide by default and show via “Positions” tab, or show as a collapsible strip (e.g. “2 open positions” with tap to expand).

- **Overlays** (Notifications, Chat, Payment, Settings)
  - Open as **full-screen modals** or **bottom sheets** from the Account tab or from a “More” / profile menu in the top bar. No permanent right-column overlay.

### 5.2 Desktop (lg and up, ≥ 1024px)

- Keep **current three-column layout**: `TerminalLayout` with left sidebar, center workspace (chart + bottom dock), right trading panel.
- Overlay panels (notifications, chat, payment, settings) remain as right-side overlays.
- No bottom tab bar; navigation is implicit (all columns visible).

---

## 6. Component-Level Changes (Outline)

| Component | Change |
|-----------|--------|
| **TerminalLayout** | Use responsive grid: default single column; `lg:grid-cols-[224px_1fr_288px]`. Optionally render **one** of left/center/right as main content below `lg` based on a “mobile tab” state (Chart / Trade / Positions / Account), and render a bottom tab bar. |
| **AppShellTerminal** | Pass a **mobile tab** state (or context) so layout and children know which view to show on small screens. Optionally provide a **symbol picker open** state for the sheet/modal. |
| **LeftSidebar** | Desktop: render as today. Mobile: **do not render** as column; instead, provide a **SymbolPicker** (or reuse symbol list) used inside a **bottom sheet / modal** opened from the top bar or Trade view. Balance/equity can be shown in a compact header or in the Account view. |
| **CenterWorkspace** | Desktop: unchanged. Mobile (when “Chart” tab active): full width, chart + minimal top bar; optionally hide or collapse BottomDock into a single line with “Positions (2)” that deep-links to Positions tab. |
| **RightTradingPanel** | Desktop: unchanged. Mobile: render **only when “Trade” tab is active** as the main content (full width); simplify layout (stacked form, larger buttons). Internal tabs (Trade / Positions / Market / History) can become the main mobile tabs or be merged (e.g. Trade + Positions as two of the bottom tabs). |
| **BottomDock** | Desktop: unchanged. Mobile: either **not** in center column, and Positions/Orders content moved to the “Positions” tab (reuse tables or card list); or a slim bar that expands to a sheet. |
| **Bottom tab bar** | **New component** (e.g. `TerminalMobileNav`): visible only below `lg`. Icons + labels: Chart, Trade, Positions, Account (and optionally More). Uses `mobileTab` state to switch main view. |
| **Top bar (mobile)** | **New or extended**: compact bar with symbol selector (opens symbol sheet), optional balance, and menu (notifications, chat, settings). Shown when Chart or Trade is active. |
| **Overlay panels** | Below `lg`, open as **full-screen modal** or **bottom sheet** instead of right-column overlay; trigger from Account tab or top-bar menu. |

---

## 7. Touch and UX

- **Touch targets**: Buttons and tappable controls at least **44×44px** (Tailwind: `min-h-[44px] min-w-[44px]` or padding).
- **Spacing**: Increase padding on key actions (Buy/Sell, place order) on small screens.
- **Forms**: Stack inputs vertically; use appropriate `inputMode` (e.g. `decimal` for size/price).
- **Tables** (positions/orders): Prefer **card list** on mobile (one card per position/order) instead of wide tables; or horizontal scroll with sticky first column and “swipe to close” if desired.
- **Charts**: Ensure chart library supports touch (zoom/pan). Drawing tools in a collapsible or secondary toolbar.
- **Safe area**: Apply safe-area insets to bottom nav and top bar (e.g. Tailwind arbitrary values `pb-[env(safe-area-inset-bottom)]`, or add custom utilities in `tailwind.config.js`) so content is not hidden by notches or home indicators.

---

## 8. State and Routing

- **Mobile tab state**: e.g. `'chart' | 'trade' | 'positions' | 'account'` in React state (or a small context). Updated by bottom tab bar; below `lg` the layout renders the corresponding view.
- **URL**: Optional — e.g. hash routes `/terminal#chart`, `/terminal#trade` so deep links and back button work. Not required for first iteration.
- **Symbol picker**: Open/close state; when open, render bottom sheet or modal with symbol list (same data as LeftSidebar).

---

## 9. Implementation Phases (Suggested)

**Phase 1 — Layout and navigation**

- Add responsive grid and mobile tab state in `TerminalLayout` (or a wrapper).
- Implement `TerminalMobileNav` (bottom tab bar) and show it only below `lg`.
- Below `lg`, render a single main area (Chart **or** Trade **or** Positions **or** Account) based on selected tab. Reuse existing components for each view (chart from CenterWorkspace, form from RightTradingPanel, positions from BottomDock or RightTradingPanel).

**Phase 2 — Left sidebar → symbol picker**

- Extract symbol list (and search) into a reusable component (e.g. `SymbolList` or `SymbolPicker`).
- On mobile, render symbol picker in a bottom sheet or full-screen modal; trigger from a symbol selector in the top bar or Trade view.
- Balance/equity: compact strip in top bar or only in Account tab.

**Phase 3 — Right panel and bottom dock on mobile**

- Trade tab: show `RightTradingPanel` (or a simplified `TradeForm`) full width; ensure touch targets and stacked layout.
- Positions tab: show positions (and optionally orders) as cards or a simplified list; reuse data from BottomDock/RightTradingPanel.
- Chart tab: chart full width; BottomDock either hidden or collapsed to a single “Positions (n)” row that switches to Positions tab.

**Phase 4 — Overlays and polish**

- Notifications, Chat, Payment, Settings: open as full-screen modals or sheets on mobile; trigger from Account or top-bar menu.
- Safe area insets, final touch target pass, and optional PWA meta tags for standalone display.

---

## 10. Files to Touch (Summary)

| Area | File(s) |
|------|--------|
| Layout | `src/features/terminal/layout/TerminalLayout.tsx` |
| Shell | `src/features/terminal/pages/AppShellTerminal.tsx` |
| Left sidebar | `src/features/terminal/components/LeftSidebar.tsx`; new: `SymbolPicker` or symbol list used in sheet |
| Center | `src/features/terminal/components/CenterWorkspace.tsx` |
| Right panel | `src/features/terminal/components/RightTradingPanel.tsx` |
| Bottom dock | `src/features/terminal/components/BottomDock.tsx` |
| New | `TerminalMobileNav.tsx` (bottom tab bar), optional `TerminalMobileTopBar.tsx`, mobile symbol sheet/modal |
| Styles | Tailwind: responsive classes (`lg:`, `md:`, default mobile), safe-area utilities if needed |
| Store | `src/features/terminal/store/terminalStore.ts` — optional `mobileTab` and `symbolPickerOpen` if not using local state |

---

## 11. Performance and Optimization (No Negative Impact)

The following guarantees ensure **no degradation of speed or optimization** on desktop or mobile:

| Guarantee | How it is enforced |
|-----------|--------------------|
| **Desktop unchanged** | At `lg` (≥1024px) the layout is the **same** as today: same grid, same three columns, same DOM structure. No extra components or logic run on desktop. Responsive classes (`hidden lg:block`, `lg:grid-cols-[...]`) are CSS-only; no JS cost. |
| **Mobile-only code runs only on small viewports** | Mobile bottom nav and symbol sheet are rendered only when viewport &lt; 1024px (e.g. conditional render with `useMediaQuery('(max-width: 1023px)')` or Tailwind `lg:hidden`). On desktop they are not in the tree, so no extra React nodes or listeners. |
| **No duplicate data or subscriptions** | Same store (`terminalStore`), same hooks (`usePriceStream`, `useAccountSummary`, WebSocket). We do **not** add duplicate API calls or WebSocket subscriptions when switching mobile tabs. Chart, positions, and orders use existing data. |
| **Single chart instance** | Only one chart is ever mounted (in `CenterWorkspace`). On mobile we show/hide the same center area by tab; we do **not** mount a second chart or duplicate chart logic. |
| **No new polling** | No new timers, `setInterval`, or `refetchInterval`. All real-time data continues to come from existing WebSocket and on-demand API calls. |
| **Minimal bundle impact** | New code is limited to a small bottom nav component, optional top bar, and responsive wrappers. No new heavy dependencies. Tree-shaking and existing code-splitting unchanged. |
| **Efficient breakpoint usage** | If `useMediaQuery` is used, it will use a single `matchMedia('(min-width: 1024px)')` listener (or similar) and set one boolean; no resize storms or excessive re-renders. |

**Summary:** Desktop keeps the current optimized layout and behavior. Mobile adds only layout/navigation and reuses the same data layer and chart; no extra network, no duplicate subscriptions, no second chart. Speed and optimization are preserved.

---

## 12. Technical Notes

- **Tailwind**: Use default breakpoints; no polling or JS for breakpoints unless needed for conditional rendering (e.g. `useMediaQuery('(min-width: 1024px)')` to switch between “desktop” and “mobile” layout logic).
- **Charts**: Terminal uses **klinecharts** (`ChartPlaceholder.tsx`). Verify klinecharts touch support (zoom/pan) on small screens; no change to data flow.
- **No new polling**: All data (prices, positions, orders) continues to come from existing WebSocket and APIs; only layout and navigation change.

---

## 13. Success Criteria

- On viewport &lt; 1024px: single main view (Chart, Trade, Positions, or Account) with bottom tab navigation.
- Symbol selection via sheet/modal; balance/account in Account tab or compact header.
- All primary actions (select symbol, place order, view positions, deposit) achievable with touch; no hover-only flows.
- On viewport ≥ 1024px: current three-column terminal unchanged.
- Safe areas respected on devices with notches/home indicators.

---

## 14. Assumptions and Risks

| Assumption | Mitigation |
|------------|------------|
| klinecharts supports touch (pinch-zoom, pan) on mobile | Test early; if not, document limitations or consider touch wrappers. |
| Bottom dock and RightTradingPanel can be reused as full-width views | Use responsive wrappers and optional simplified sub-components (e.g. positions as cards) to avoid duplicate logic. |
| No backend or API changes required | Confirmed; only frontend layout and navigation change. |
| Desktop behavior must remain unchanged at `lg` and above | Use `lg:`-scoped classes and conditional rendering so default (mobile) and `lg:` (desktop) paths are clear. |

---

## 15. Next Step

After stakeholder approval, implementation can start with **Phase 1** (responsive layout + bottom tab bar + single main view per tab) and then proceed through phases 2–4 as needed.
