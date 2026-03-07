# Root cause: Permission profile reverts when another user opens popup and saves

**Date:** 2026-03-07  
**Page:** `/admin/permissions` — Create/Edit permission profile popup  
**Symptom:** When you save changes, the profile updates correctly in the database. But when a manager/admin opens that same profile in the popup and saves again, the profile’s permissions revert (or the manager “gets back” permissions). So the last save seems to overwrite the profile with old data.

---

## Root cause (summary)

The **Edit** popup is filled from the **profile object that comes from the table row** (the cached list of profiles). It does **not** refetch the profile by ID when you open Edit.

So:

1. **Admin** changes profile “V2” (e.g. removes some permissions) and clicks **Save**.  
   - Backend updates the profile in the DB.  
   - Only the **admin’s** React Query cache is invalidated and refetched, so the admin sees the new list.

2. **Manager** (or another admin) has the Permissions page open in another tab/session.  
   - Their list of profiles was loaded earlier and is **still the old one** (e.g. “V2” still has the old permission set).  
   - Query cache is **per browser tab/session**; the manager’s cache is **not** invalidated when the admin saves.

3. **Manager** clicks **Edit** on “V2”.  
   - `openEdit(profile)` is called with `profile` = the row from the **manager’s cached list**.  
   - So `profile.permissionIds` is the **old** list of permission keys (before the admin’s change).

4. The popup opens with the form set to those **old** permissions (all the checkboxes that were there before).

5. **Manager** clicks **Save** (e.g. without changing anything, or after a small change).  
   - Frontend sends **PUT** with `permission_keys` = the form state = the **old** list.  
   - Backend overwrites the profile’s grants with that list.

6. Result: the profile in the DB is **reverted** to the old permissions. So “when manager/admin opens that popup and save again”, the profile **gets back** the old permissions (and thus managers with that profile “get” those permissions again after the next `refreshUser()` or re-login).

So the bug is **stale list data used to populate the Edit form**. Only the user who saved invalidates their cache; anyone else still has the old list and, by opening Edit and saving, overwrites the profile with that stale data.

---

## Where in the code

| Place | What happens |
|-------|-------------------------------|
| **PermissionsPage.tsx** | `openEdit(profile)` is called when user clicks Edit. It sets form state from `profile` (name, description, `profile.permissionIds`). That `profile` is always the one from the table row (from `listPermissionProfiles()`). |
| **Table “Edit” button** | `onClick={() => openEdit(profile)}` — `profile` is `row.original`, i.e. from the current list data (cached). |
| **No refetch on Edit** | There is no call to `getPermissionProfile(editingId)` when opening Edit. So we never load the latest profile from the API for the dialog. |
| **onSuccess** | After create/update/delete we only do `queryClient.invalidateQueries({ queryKey: QUERY_KEY })`. That invalidates **only in the current tab/session**. Other users’ caches are unchanged. |

---

## Fix (to apply after you confirm this is the root cause)

1. **When opening Edit, load the profile by ID**  
   - On “Edit” click, call `getPermissionProfile(profile.id)` (or use a query keyed by `editingId`) and populate the form from that response.  
   - Then the form always shows the **current** profile from the server, not the cached row.

2. **Optional: invalidate list when opening Edit**  
   - When opening the Edit dialog, you can also invalidate the list query so the table refetches. That helps keep the table in sync; the main fix is still to populate the form from a fresh fetch by ID.

Once you confirm this matches what you see, the code change can be: “on Edit click, fetch profile by id and open the dialog when loaded; populate form from that fetched profile.”
