import { useCanAccess } from '@/shared/utils/permissions'
import { LEAD_PERMISSIONS } from '@/shared/utils/permissions'

export function useLeadPermissions() {
  const canViewAll = useCanAccess(LEAD_PERMISSIONS.VIEW_ALL)
  const canViewAssigned = useCanAccess(LEAD_PERMISSIONS.VIEW_ASSIGNED)
  const canCreate = useCanAccess(LEAD_PERMISSIONS.CREATE)
  const canEdit = useCanAccess(LEAD_PERMISSIONS.EDIT)
  const canDelete = useCanAccess(LEAD_PERMISSIONS.DELETE)
  const canAssign = useCanAccess(LEAD_PERMISSIONS.ASSIGN)
  const canChangeStage = useCanAccess(LEAD_PERMISSIONS.CHANGE_STAGE)
  const canExport = useCanAccess(LEAD_PERMISSIONS.EXPORT)
  const canSettings = useCanAccess(LEAD_PERMISSIONS.SETTINGS)
  const canTemplates = useCanAccess(LEAD_PERMISSIONS.TEMPLATES)
  const canAssignment = useCanAccess(LEAD_PERMISSIONS.ASSIGNMENT)
  const canImport = useCanAccess(LEAD_PERMISSIONS.IMPORT)

  return {
    canViewAll,
    canViewAssigned,
    canCreate,
    canEdit,
    canDelete,
    canAssign,
    canChangeStage,
    canExport,
    canSettings,
    canTemplates,
    canAssignment,
    canImport,
  }
}
