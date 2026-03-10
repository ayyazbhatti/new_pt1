# Solution: User View Page Not Visible Until Second Save

## Problem Summary

When an admin's permission profile is updated to grant `users:view` (or when their user record is assigned a profile that has `users:view`), the **Users** nav item and **Users** page remain hidden until something else triggers a refetch of the current user (e.g. tab focus, token refresh, or full reload). The backend and `/api/auth/me` already return the correct permissions; the frontend auth store is not updated after permission-affecting saves.

**Root cause:** The auth store's `user.permissions` is only updated on login, register, `hydrateFromStorage`, or when `refreshUser()` is called. Saving a permission profile or updating a user's assigned profile never calls `refreshUser()`, so nav and route guards keep using stale permissions.

---

## Solution Overview

After any save that can change the **current user's** effective permissions, call `refreshUser()` so the auth store gets the new permissions and the UI (sidebar, route guard) updates immediately.

Two places must be updated:

1. **Permissions page** — after updating or deleting a permission profile that is the current user's profile.
2. **User edit modal** — after updating a user when the updated user is the current user (e.g. admin edits their own permission profile assignment).

No backend changes. No polling. One extra `/api/auth/me` call only when the current user is affected.

---

## Implementation Plan

### 1. Permissions Page (`src/features/permissions/pages/PermissionsPage.tsx`)

**Goal:** When the current user's permission profile is updated or deleted, refresh the current user so their permissions (and thus nav/route visibility) update immediately.

**Changes:**

1. **Import auth store**  
   - Add: `import { useAuthStore } from '@/shared/store/auth.store'`

2. **Read current user's profile ID**  
   - At the top of `PermissionsPage`, add:  
     `const currentUserProfileId = useAuthStore((s) => s.user?.permissionProfileId ?? null)`

3. **Get `refreshUser`**  
   - Add: `const refreshUser = useAuthStore((s) => s.refreshUser)`

4. **After successful profile update (in `handleSave` → `onSaveSuccess`):**  
   - After `await queryClient.invalidateQueries({ queryKey: QUERY_KEY })`, add:  
     - If `editingId === currentUserProfileId`, call `await refreshUser()` (or `refreshUser().catch(...)` if we prefer not to block dialog close).  
   - Then call `closeDialog()` as today.

5. **After successful profile delete:**  
   - `deleteMutation` uses `mutationFn: deletePermissionProfile` which takes `(id: string)`. When we call `mutate(profile.id)`, TanStack Query passes that as the **variables** argument to `onSuccess`.  
   - Change `deleteMutation` to use `onSuccess: (_, deletedProfileId) => { ... }` (second parameter is the mutation variables, i.e. the deleted profile id).  
   - After existing `queryClient.invalidateQueries` and `toast.success`, if `deletedProfileId === currentUserProfileId`, call `refreshUser().catch(...)`.  
   - `currentUserProfileId` and `refreshUser` are in component scope, so they are available inside `onSuccess`.

**Exact logic:**

- **Update:** In `onSaveSuccess` (used by update mutation): after invalidateQueries, if `editingId === currentUserProfileId`, call `refreshUser().catch((e) => console.error('Failed to refresh user after profile update', e))`, then `closeDialog()`.
- **Delete:** In `deleteMutation`, change `onSuccess` to a function that receives `(_, deletedProfileId)` (second argument is the mutation variable). After existing invalidateQueries and toast, if `deletedProfileId === currentUserProfileId`, call `refreshUser().catch((e) => console.error('Failed to refresh user after profile delete', e))`.
- **Create:** Do nothing (current user cannot have the newly created profile yet).

### 2. CreateEditUserModal (`src/features/adminUsers/modals/CreateEditUserModal.tsx`)

**Goal:** When the updated user is the current user (e.g. admin edits their own record and changes their permission profile), refresh the current user so their permissions update immediately.

**Changes:**

1. **Import auth store**  
   - Add: `import { useAuthStore } from '@/shared/store/auth.store'`

2. **Get current user id and `refreshUser`**  
   - Add: `const currentUserId = useAuthStore((s) => s.user?.id ?? null)`  
   - Add: `const refreshUser = useAuthStore((s) => s.refreshUser)`

3. **After successful user update (in `onSubmit`, inside the `if (user)` branch, after all API calls and cache updates):**  
   - Before `closeModal(...)`, add:  
     - If `user.id === currentUserId`, call `await refreshUser()` (or `refreshUser().catch(...)` so a failure doesn't block closing the modal).  
   - Then `toast.success` and `closeModal` as today.

**Exact logic:** After `await queryClient.invalidateQueries({ queryKey: ['users'] })`, if `user.id === currentUserId`, call `await refreshUser()` (or catch and log on error), then show toast and close modal.

---

## Why This Works 100%

1. **Single source of truth:** Nav and route guard use `user.permissions` from the auth store. `refreshUser()` fetches `/api/auth/me` and updates the store with the same payload used at login (including `permissions` from `get_effective_permissions`). So one call is enough to align the UI with the backend.

2. **Backend is already correct:** `/api/auth/me` and login both compute permissions from the DB on every request. No backend change or cache invalidation needed.

3. **Only when affected:** We call `refreshUser()` only when the current user's profile was updated/deleted (Permissions page) or when the current user's record was updated (CreateEditUserModal). No unnecessary refetches for other users.

4. **No race conditions:** We refresh after the mutation has succeeded and (on Permissions page) after profile list invalidation. The next `/me` will see the updated profile grants or user profile assignment.

5. **Existing pattern:** The app already uses `refreshUser()` after token refresh and on tab focus. We are reusing the same mechanism at the two places where permission-affecting saves happen.

---

## Acceptance Criteria

- [ ] **Permissions page — update own profile:** Admin with profile "Permission_test" (only `users:view`) opens Permissions, edits that profile (e.g. add another permission or leave as-is), saves. **Expected:** Users nav item and `/admin/users` are visible immediately after dialog closes, without switching tabs or reloading.
- [ ] **Permissions page — delete own profile:** Admin whose profile is "Permission_test" deletes that profile (or another admin deletes it). **Expected:** After delete, if current user had that profile, their permissions refresh (e.g. Users link disappears if they no longer have any profile).
- [ ] **Permissions page — edit other profile:** Admin edits a profile that is not their own. **Expected:** No extra refresh; behavior unchanged.
- [ ] **User edit — self:** Admin edits their own user record (e.g. changes their permission profile to one that has `users:view`), saves. **Expected:** Users nav and page become visible immediately after modal closes.
- [ ] **User edit — other user:** Admin edits another user's permission profile. **Expected:** No refresh for current user; only the table/cache update as today.
- [ ] **No regression:** Login, tab focus refresh, and token-refresh flow still work. Other pages (e.g. Permissions table, "Permissions by profile" tab) still update correctly after save.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/features/permissions/pages/PermissionsPage.tsx` | Import `useAuthStore`; add `currentUserProfileId` and `refreshUser`; in update save success, if edited profile is current user's, call `refreshUser()`; in delete mutation `onSuccess`, if deleted profile is current user's, call `refreshUser()`. |
| `src/features/adminUsers/modals/CreateEditUserModal.tsx` | Import `useAuthStore`; add `currentUserId` and `refreshUser`; after successful user update, if `user.id === currentUserId`, call `refreshUser()`. |

---

## Out of Scope

- Backend changes (none required).
- Refreshing when **another** user's profile is assigned in the Users table (only the user who was edited gets their permissions refreshed when they are the current user).
- Polling or timers (we remain event-driven only).

---

## References

- Root cause: auth store `user.permissions` not updated after permission-related saves; see conversation and verification.
- Auth store: `src/shared/store/auth.store.ts` (`refreshUser` calls `/api/auth/me` and sets `user`).
- Permission checks: `src/shared/utils/permissions.ts` (`getCurrentUserPermissions(user)` uses `user.permissions`); `Sidebar.tsx` and `AdminRouteGuard.tsx` use `canAccess(..., user)`.
