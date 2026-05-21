# Phase 3 — Central currency module (frontend foundation)

## Goal

Introduce `src/shared/currency/` as the **single future source of truth** for monetary display in the UI, mirroring the layout of `src/shared/datetime/`. **No existing components import this module yet** (Phase 5 wiring). **No backend changes** in this phase.

## Files created (7)

| File | Role |
|------|------|
| `types.ts` | `CurrencyCode`, `CurrencySource`, `ResolvedCurrency`, `FxRatesSnapshot` (aligns with admin FX API camelCase). |
| `resolve.ts` | Pure resolution: user → group → platform → `USD` fallback; `isValidCurrencyCode` via `Intl`. |
| `format.ts` | Pure formatters: `formatAmount`, `convertAmount`, `formatFromUsd`, `formatConverted`, `formatSignedFromUsd`; `MoneyInput` type. |
| `rates.ts` | `fetchFxRates`, `useFxRates` (React Query), `useFxRatesMap`; placeholder `GET /api/admin/fx-rates`. |
| `context.tsx` | `CurrencyContext`, `CurrencyProvider`, `CurrencyOverrideProvider` (admin drill-down pattern matches timezone). |
| `hooks.ts` | Curried hooks: `useFormatFromUsd`, `useFormatSignedFromUsd`, `useFormatAmount`, `useFormatConverted`, `useCurrencyCode`, `useCurrencySymbol`. |
| `index.ts` | Public barrel: `import { … } from '@/shared/currency'`. |

## Resolution priority (mirrors timezone)

1. `userCurrency` (if valid ISO per `Intl`)  
2. `groupCurrency`  
3. `platformCurrency`  
4. Fallback **`USD`** with `origin: 'fallback'`

## Phase 5 usage (preview)

- **`useFormatFromUsd()`**: returns `(amount) => string` for equity, balance, margin figures already USD-normalized (post Phase 2).  
- **`useFormatSignedFromUsd()`**: same with **`+` / `-`** prefix for PnL-style fields.  
- Wrap app (or shell) in **`CurrencyProvider`** with `CurrencySource` from user + group + platform settings once those exist in client state.

## FX rates loading

- **`fetchFxRates`** / **`useFxRates`** call **`/api/admin/fx-rates`** today (requires `settings:view`).  
- **TODO (Phase 4)**: add **`GET /api/fx-rates/current`** for any authenticated user, same JSON shape, so traders load rates without admin permission. Documented in `rates.ts` file header.  
- On failure, **`fetchFxRates`** returns a **USD-only** snapshot `{ rates: { USD: '1' }, fetchedAt: null, source: 'fallback', isStale: true }`.  
- React Query: **`staleTime` 30 minutes**, **`gcTime` 1 hour**, **no `refetchInterval`** (no polling).

## Conversion math (same as backend `convert_with_rates`)

Rates mean **1 USD = N units** of each quote currency.  

`convertAmount(amount, from, to, rates)` → `amount * rateTo / rateFrom` (with USD rate = 1, USDT/USDC normalized to USD).

### Acceptance test calculations (numeric)

With `rates = { USD: '1', EUR: '0.92', PKR: '278.5', JPY: '156.4', HUF: '360' }`:

| Expression | Expected |
|------------|----------|
| `convertAmount(100, 'USD', 'PKR', rates)` | **27850** |
| `convertAmount(100, 'USD', 'USD', rates)` | **100** |
| `convertAmount(100, 'USDT', 'USD', rates)` | **100** |
| `convertAmount(100, 'EUR', 'PKR', rates)` | **≈ 30271.73913043478** (`100 * 278.5 / 0.92`) |
| `convertAmount(100, 'USD', 'XYZ', rates)` | **null** |

Verified with `node` reproducing the same logic (see chat / local run).

### Formatted strings (`formatFromUsd`)

Strings depend on **`Intl`** (`en-US`) and currency rules, e.g.:

- `formatFromUsd(1000, 'USD', rates)` → `"$1,000.00"`  
- `formatFromUsd(1000, 'PKR', rates)` → PKR amount with **Rs** or **PKR** prefix per environment  
- `formatFromUsd(1000, 'JPY', rates)` → yen with **0** fraction digits  
- `formatFromUsd(1000, 'BTC', rates)` → **"—"** (no `BTC` in `rates`; conversion fails)  
- `formatFromUsd(null, 'USD', rates)` → **"—"**

## Smoke test (this change)

1. **`git status src/shared/currency/ docs/phase-3-currency-foundation.md`** — only these paths added for Phase 3 (workspace may have other unrelated dirty files).  
2. **`npx tsc --noEmit`** — completed with **exit code 0** (no new TS errors from this module).  
3. **`npm run build`** — same as `tsc && vite build`; run before release (not re-run here if redundant after `tsc`).  
4. **UI** — unchanged: nothing imports `@/shared/currency` yet; bottom dock, terminal, admin unchanged.

## Path alias

`tsconfig.json` has `"@/*": ["./src/*"]` → `@/shared/currency` resolves to `src/shared/currency/index.ts`.

## React Query note

`useFxRates` / `useFxRatesMap` / formatting hooks that call them must run under an existing **`QueryClientProvider`** (already used by the app). No provider was added in Phase 3.

## Next phases (pointer)

- **Phase 4**: backend + optional admin UI for platform currency; **`/api/fx-rates/current`**.  
- **Phase 5**: replace duplicate `formatCurrency` call sites with this module + wire `CurrencyProvider`.  
- **Phase 6**: cleanup / deprecate old helpers.
