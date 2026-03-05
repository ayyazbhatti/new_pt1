import { useRef, useEffect } from 'react'
import { useCallStore } from '../store/callStore'
import { Button } from '@/shared/ui/button'
import { PhoneOff } from 'lucide-react'
import { wsClient } from '@/shared/ws/wsClient'

export function InCallBar() {
  const activeCallId = useCallStore((s) => s.activeCallId)
  const setActiveCallId = useCallStore((s) => s.setActiveCallId)
  const remoteStream = useCallStore((s) => s.remoteStream)
  const voiceUnavailable = useCallStore((s) => s.voiceUnavailable)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  if (!activeCallId) return null

  const handleEnd = () => {
    wsClient.send({ type: 'call.end', call_id: activeCallId })
    setActiveCallId(null)
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-full bg-surface border border-border shadow-lg">
      {remoteStream && <audio ref={audioRef} autoPlay playsInline />}
      <span className="text-sm">
        <span className="font-medium">Call connected</span>
        {voiceUnavailable && <span className="ml-1.5 text-text-muted text-xs">— no audio</span>}
      </span>
      <Button variant="danger" size="sm" onClick={handleEnd} className="gap-1">
        <PhoneOff className="h-3 w-3" />
        End
      </Button>
    </div>
  )
}
