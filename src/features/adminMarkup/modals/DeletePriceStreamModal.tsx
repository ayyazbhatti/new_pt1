import { useState } from 'react'
import { useModalStore } from '@/app/store'
import { MarkupProfile } from '../types/markup'
import { Trash2 } from 'lucide-react'

interface DeletePriceStreamModalProps {
  stream: MarkupProfile
}

export function DeletePriceStreamModal({ stream }: DeletePriceStreamModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [deleting, setDeleting] = useState(false)
  const modalKey = `delete-price-stream-${stream.id}`

  const handleDelete = async () => {
    setDeleting(true)
    try {
      // Placeholder: call delete API when available
      await new Promise((r) => setTimeout(r, 600))
      closeModal(modalKey)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-slate-800 rounded-lg p-4 sm:p-6 w-full max-w-md border border-slate-700">
      <div className="flex items-start space-x-3 sm:space-x-4">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
          <Trash2 className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-semibold text-white mb-2">
            Delete Price Stream
          </h2>
          <p className="text-sm sm:text-base text-slate-300 mb-4">
            Are you sure you want to delete the price stream{' '}
            <span className="font-semibold text-white">{stream.name}</span>? This
            action cannot be undone.
          </p>
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:space-x-3 mt-6">
        <button
          type="button"
          onClick={() => closeModal(modalKey)}
          disabled={deleting}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm sm:text-base"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center space-x-2 text-sm sm:text-base disabled:opacity-50"
        >
          {deleting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Deleting...</span>
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
