import { useQuery } from '@tanstack/react-query'
import { leadQueryKeys } from '../api/leads.ws'

import * as api from '../api/leads.api'

export function useTaskList(assignedToUserId: string | undefined) {
  return useQuery({
    queryKey: [...leadQueryKeys.all, 'taskList', assignedToUserId],
    queryFn: () => api.listTasks(assignedToUserId),
    enabled: true,
  })
}
