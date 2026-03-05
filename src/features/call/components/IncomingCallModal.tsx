import { useCallStore } from '../store/callStore'
import { Button } from '@/shared/ui/button'
import { Phone, PhoneOff } from 'lucide-react'
import { wsClient } from '@/shared/ws/wsClient'

export function IncomingCallModal() {
  const incomingCall = useCallStore((s) => s.incomingCall)
  const setIncomingCall = useCallStore((s) => s.setIncomingCall)
  const setActiveCallId = useCallStore((s) => s.setActiveCallId)

  if (!incomingCall) return null

  const displayName = incomingCall.admin_display_name ?? 'Admin'

  const handleAccept = () => {
    wsClient.send({ type: 'call.answer', call_id: incomingCall.call_id })
    setActiveCallId(incomingCall.call_id)
    setIncomingCall(null)
  }

  const handleReject = () => {
    wsClient.send({ type: 'call.reject', call_id: incomingCall.call_id })
    setIncomingCall(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface border border-border rounded-xl shadow-lg p-6 max-w-sm w-full space-y-4">
        <p className="text-lg font-medium text-center">Incoming call</p>
        <p className="text-center text-text-muted">from {displayName}</p>
        <div className="flex gap-3 justify-center">
          <Button variant="danger" onClick={handleReject} className="gap-2">
            <PhoneOff className="h-4 w-4" />
            Reject
          </Button>
          <Button variant="success" onClick={handleAccept} className="gap-2">
            <Phone className="h-4 w-4" />
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
