import { http } from '@/shared/api/http'

export interface PermissionProfileDto {
  id: string
  name: string
  description?: string | null
  permission_keys: string[]
  created_at: string
  updated_at: string
  created_by_user_id?: string
  created_by_email?: string
  tag_ids?: string[]
}

export interface PermissionProfile {
  id: string
  name: string
  description?: string
  permissionIds: string[]
  createdByUserId?: string
  createdByEmail?: string
  tagIds?: string[]
}

function fromDto(d: PermissionProfileDto): PermissionProfile {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? undefined,
    permissionIds: d.permission_keys ?? [],
    createdByUserId: d.created_by_user_id,
    createdByEmail: d.created_by_email,
    tagIds: Array.isArray(d.tag_ids) ? d.tag_ids : [],
  }
}

export async function listPermissionProfiles(): Promise<PermissionProfile[]> {
  const list = await http<PermissionProfileDto[]>('/api/admin/permission-profiles', { method: 'GET' })
  return list.map(fromDto)
}

export async function getPermissionProfile(id: string): Promise<PermissionProfile | null> {
  try {
    const d = await http<PermissionProfileDto>(`/api/admin/permission-profiles/${id}`, { method: 'GET' })
    return fromDto(d)
  } catch {
    return null
  }
}

export async function createPermissionProfile(payload: {
  name: string
  description?: string
  permission_keys: string[]
}): Promise<PermissionProfile> {
  const d = await http<PermissionProfileDto>('/api/admin/permission-profiles', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return fromDto(d)
}

export async function updatePermissionProfile(
  id: string,
  payload: { name?: string; description?: string | null; permission_keys?: string[] }
): Promise<PermissionProfile> {
  const d = await http<PermissionProfileDto>(`/api/admin/permission-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return fromDto(d)
}

export async function deletePermissionProfile(id: string): Promise<void> {
  await http(`/api/admin/permission-profiles/${id}`, { method: 'DELETE' })
}

/** Get tag IDs assigned to a permission profile. */
export async function getPermissionProfileTags(profileId: string): Promise<string[]> {
  const res = await http<{ tag_ids: string[] }>(
    `/api/admin/permission-profile-tags/${profileId}`,
    { method: 'GET' }
  )
  return res.tag_ids ?? []
}

/** Assign tags to a permission profile (replaces existing). */
export async function setPermissionProfileTags(
  profileId: string,
  tagIds: string[]
): Promise<void> {
  await http(`/api/admin/permission-profile-tags/${profileId}`, {
    method: 'PUT',
    body: JSON.stringify({ tag_ids: tagIds }),
  })
}

export async function listPermissionKeys(): Promise<string[]> {
  return http<string[]>('/api/admin/permission-profiles/keys', { method: 'GET' })
}

/** Category with permissions (from DB) for Create/Edit profile modal and Permissions tab */
export interface PermissionDefinitionDto {
  id: string
  key: string
  label: string
  sort_order: number
}

export interface PermissionCategoryDto {
  id: string
  name: string
  sort_order: number
  permissions: PermissionDefinitionDto[]
}

export async function listPermissionDefinitions(): Promise<PermissionCategoryDto[]> {
  return http<PermissionCategoryDto[]>('/api/admin/permission-profiles/definitions', { method: 'GET' })
}
