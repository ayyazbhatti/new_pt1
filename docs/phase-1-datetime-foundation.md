# Phase 1 — Central datetime foundation

This document describes the **Phase 1** deliverable for per-user effective timezone: a **new** `src/shared/datetime/` module that is the future single source of truth for timestamp display. **No existing formatters were changed** in this phase.

## Files created (6)

| File | Role |
|------|------|
| `src/shared/datetime/types.ts` | `IanaTimezone`, `TimezoneSource`, `ResolvedTimezone`, `TimezoneOrigin` |
| `src/shared/datetime/resolve.ts` | `isValidIanaTimezone`, `resolveEffectiveTimezone`, `getUtcOffsetLabel` (pure, no React) |
| `src/shared/datetime/format.ts` | Pure formatters: `formatDateTime`, `formatDate`, `formatTime`, `formatDateTimeSeconds`, `formatRelative`, `fromZonedWallClock` + `DateInput` |
| `src/shared/datetime/context.tsx` | `TimezoneContext`, `TimezoneProvider`, `TimezoneOverrideProvider` |
| `src/shared/datetime/hooks.ts` | `useEffectiveTimezone`, curried `useFormat*` hooks, `useTimezoneOffsetLabel` |
| `src/shared/datetime/index.ts` | Public barrel: `import { … } from '@/shared/datetime'` |

## Resolution priority chain

`resolveEffectiveTimezone(source)` (`resolve.ts`):

1. **`userTimezone`** — if valid IANA (via `Intl.DateTimeFormat` probe), `origin: 'user'`.
2. Else **`groupTimezone`** — if valid, `origin: 'group'`.
3. Else **`platformTimezone`** — if valid, `origin: 'platform'`.
4. Else **`UTC`**, `origin: 'fallback'`.

`isValidIanaTimezone` rejects empty/invalid strings so bad config does not break formatting.

## Formatting approach

- All formatters in `format.ts` take an explicit **`timezone: IanaTimezone`** argument (no hidden global).
- Implementation uses **`Intl.DateTimeFormat`** with `timeZone` and **`en-GB`** locale for day-first style strings (e.g. `21 May 2026, 14:32`).
- **No new dependencies** (`date-fns-tz` not added).

## How later phases will use this

| Phase | Intended work |
|-------|----------------|
| **Phase 2** | Backend: `users.timezone`, `user_groups.timezone`, expose effective zone on `/api/auth/me` (or dedicated endpoint), load `platform_general_settings.timezone` for platform tier. |
| **Phase 3** | UI: Mount `TimezoneProvider` at app shell (and `TimezoneOverrideProvider` around admin “view as user” subtrees). Replace duplicate `formatDateTime` implementations with imports from `@/shared/datetime` (pure functions + hooks). |
| **Phase 4** | Edge cases: charts (`klinecharts`), appointment email copy, CSV exports, tests, QA. |

## Path alias

`tsconfig.json` maps `@/*` → `./src/*`, so:

```ts
import { formatDateTime, resolveEffectiveTimezone } from '@/shared/datetime'
```

resolves to `src/shared/datetime/index.ts`.

## Smoke test (manual)

In a scratch TS file, REPL, or browser console after wiring a minimal import:

```ts
import { formatDateTime, resolveEffectiveTimezone } from '@/shared/datetime'

formatDateTime('2026-05-21T09:32:00Z', 'Asia/Karachi') // expect "21 May 2026, 14:32"
formatDateTime('2026-05-21T09:32:00Z', 'America/New_York') // expect "21 May 2026, 05:32"

resolveEffectiveTimezone({ userTimezone: 'Europe/London' })
// { iana: 'Europe/London', origin: 'user' }

resolveEffectiveTimezone({ userTimezone: null, groupTimezone: 'Asia/Karachi' })
// { iana: 'Asia/Karachi', origin: 'group' }

resolveEffectiveTimezone({})
// { iana: 'UTC', origin: 'fallback' }
```

**Note:** Exact strings can vary slightly by engine for edge transitions (DST); the examples assume stable offsets on the given date.

## Verification commands

```bash
npm run build
git diff --name-only
```

Expect `git diff --name-only` to list **only** new paths under `src/shared/datetime/` and this doc (and no edits to legacy `formatDateTime` files).
