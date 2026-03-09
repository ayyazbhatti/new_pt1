import { useEffect, useRef } from 'react'
import { useCallStore } from '../store/callStore'
import { Button } from '@/shared/ui/button'
import { Phone, PhoneOff } from 'lucide-react'
import { wsClient } from '@/shared/ws/wsClient'
import { getPlayableAudioContext } from '../audioUnlock'

/** Two-tone phone ring using Web Audio API (plays while incoming call is shown, stops on accept/reject). */
function useRingtone(active: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSharedRef = useRef(false)

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const { ctx, isShared } = getPlayableAudioContext()
    isSharedRef.current = isShared

    const playTone = (frequency: number, durationMs: number) => {
      if (ctx.state === 'closed') return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + durationMs / 1000)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + durationMs / 1000)
    }

    const ring = () => {
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          playTone(440, 400)
          setTimeout(() => playTone(554, 400), 600)
        }).catch(() => {})
      } else {
        playTone(440, 400)
        setTimeout(() => playTone(554, 400), 600)
      }
    }

    ctx.resume().then(() => {
      ring()
      intervalRef.current = setInterval(ring, 2000)
    }).catch(() => {})

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (!isSharedRef.current && ctx.state !== 'closed') {
        ctx.close().catch(() => {})
      }
    }
  }, [active])
}

export function IncomingCallModal() {
  const incomingCall = useCallStore((s) => s.incomingCall)
  const setIncomingCall = useCallStore((s) => s.setIncomingCall)
  const setActiveCallId = useCallStore((s) => s.setActiveCallId)

  useRingtone(!!incomingCall)

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
