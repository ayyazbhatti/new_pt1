import { Trash2 } from 'lucide-react'
import { useDeleteAffiliateLayer } from '../hooks/useAffiliateLayers'
import type { AffiliateLayer } from '../api/affiliateLayers.api'
import { toast } from '@/shared/components/common'

interface DeleteSchemeModalProps {
  layer: AffiliateLayer
  onClose: () => void
}

export function DeleteSchemeModal({ layer, onClose }: DeleteSchemeModalProps) {
  const deleteMutation = useDeleteAffiliateLayer()

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(layer.id)
      toast.success('Scheme deleted')
      onClose()
    } catch {
      toast.error('Failed to delete scheme')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg border border-slate-700 shadow-2xl w-full max-w-md">
        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="p-2 sm:p-3 rounded-full bg-red-400/10 flex-shrink-0">
              <Trash2 className="w-5 h-5 sm:w-6 sm:h-6 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Delete Scheme</h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 break-words">
                Are you sure you want to delete scheme &quot;{layer.name}&quot;? This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {deleteMutation.isPending ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
