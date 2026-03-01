import { X, CheckCircle } from 'lucide-react'
import type { AffiliateUser } from '../api/affiliateUsers.api'

function shortId(id: string): string {
  return id && id.length >= 8 ? id.slice(0, 8) : id
}

function displayName(user: AffiliateUser): string {
  const parts = [user.firstName, user.lastName].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.email
}

interface AffiliateDetailsModalProps {
  user: AffiliateUser
  onClose: () => void
}

export function AffiliateDetailsModal({ user, onClose }: AffiliateDetailsModalProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] bg-slate-800 border border-slate-700 rounded-lg flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center flex-shrink-0 p-3 sm:p-4 border-b border-slate-700">
          <h2 className="text-base sm:text-lg font-bold text-white truncate flex-1 pr-2">
            Affiliate Details: {user.referralCode ?? shortId(user.id)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-md text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 min-h-0">
          <section className="bg-slate-700 p-3 sm:p-4 md:p-6 rounded-lg mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-white mb-3 sm:mb-4">Basic Information</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-slate-400 block mb-1">Affiliate code</span>
                <span className="text-white font-mono">{user.referralCode ?? '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Owner</span>
                <span className="text-white">User {shortId(user.id)}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Email</span>
                <span className="text-white">{user.email}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Name</span>
                <span className="text-white">{displayName(user)}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Scheme</span>
                <span className="text-white">—</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Status</span>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border border-green-500/50 bg-green-500/20 text-green-400">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Active
                </span>
              </div>
            </div>
          </section>
          <section className="bg-slate-700 p-3 sm:p-4 md:p-6 rounded-lg">
            <h3 className="text-sm sm:text-base font-semibold text-white mb-3 sm:mb-4">Timeline</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-slate-400 block mb-1">Created</span>
                <span className="text-white">—</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">Last updated</span>
                <span className="text-white">—</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
