import { Trash2 } from 'lucide-react'
import type { AffiliateUser } from '../api/affiliateUsers.api'
import { toast } from '@/shared/components/common'

interface DeleteAffiliateModalProps {
  user: AffiliateUser
  onClose: () => void
}

export function DeleteAffiliateModal({ user, onClose }: DeleteAffiliateModalProps) {
  const code = user.referralCode ?? user.id.slice(0, 8)

  const handleDelete = async () => {
    // Backend may not have delete affiliate endpoint yet - show toast
    toast.error('Delete affiliate is not available yet.')
    onClose()
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
              <h2 className="text-lg font-bold text-white">Delete Affiliate</h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 break-words">
                Are you sure you want to delete affiliate &quot;{code}&quot;? This action cannot be undone.
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
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
