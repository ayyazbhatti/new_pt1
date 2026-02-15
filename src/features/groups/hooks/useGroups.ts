import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupUsage,
  updateGroupPriceProfile,
} from '../api/groups.api'
import { ListGroupsParams, ListGroupsResponse, CreateGroupPayload, UpdateGroupPayload } from '../types/group'

// Query key factory (exported for optimistic cache updates)
export const groupsQueryKeys = {
  all: ['adminGroups'] as const,
  lists: () => [...groupsQueryKeys.all, 'list'] as const,
  list: (params?: ListGroupsParams) => [...groupsQueryKeys.lists(), params] as const,
  detail: (id: string) => [...groupsQueryKeys.all, 'detail', id] as const,
  usage: (id: string) => [...groupsQueryKeys.all, 'usage', id] as const,
}

const queryKeys = groupsQueryKeys

export function useGroupsList(params?: ListGroupsParams) {
  return useQuery({
    queryKey: queryKeys.list(params),
    queryFn: () => listGroups(params),
  })
}

export function useGroup(id: string | null) {
  return useQuery({
    queryKey: queryKeys.detail(id!),
    queryFn: () => getGroup(id!),
    enabled: !!id,
  })
}

export function useGroupUsage(id: string | null) {
  return useQuery({
    queryKey: queryKeys.usage(id!),
    queryFn: () => getGroupUsage(id!),
    enabled: !!id,
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateGroupPayload) => createGroup(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Group created successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to create group'
      toast.error(message)
    },
  })
}

export function useUpdateGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateGroupPayload }) =>
      updateGroup(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(variables.id) })
      toast.success('Group updated successfully')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to update group'
      toast.error(message)
    },
  })
}

export function useUpdateGroupPriceProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ groupId, priceProfileId }: { groupId: string; priceProfileId: string | null }) =>
      updateGroupPriceProfile(groupId, priceProfileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Price profile updated')
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || 'Failed to update price profile'
      toast.error(message)
    },
  })
}

export function useDeleteGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() })
      toast.success('Group deleted successfully')
    },
    onError: (error: any) => {
      const errorData = error?.response?.data?.error
      const code = errorData?.code
      const message = errorData?.message || error?.message || 'Failed to delete group'
      
      if (code === 'GROUP_IN_USE') {
        toast.error('Cannot delete group: It has assigned users. Remove users first.')
      } else {
        toast.error(message)
      }
    },
  })
}

