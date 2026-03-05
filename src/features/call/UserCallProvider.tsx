import { useEffect, useRef, useCallback } from 'react'
import { useCallStore } from './store/callStore'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'
import { IncomingCallModal } from './components/IncomingCallModal'
import { InCallBar } from './components/InCallBar'

const CALL_EVENT_TYPES = new Set([
  'call.incoming',
  'call.ringing',
  'call.accepted',
  'call.rejected',
  'call.ended',
  'call.error',
  'call.webrtc.offer',
  'call.webrtc.answer',
  'call.webrtc.ice',
])

const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/**
 * Subscribes to WS and updates call store; runs user (callee) WebRTC when in call.
 */
export function UserCallProvider() {
  const setIncomingCall = useCallStore((s) => s.setIncomingCall)
  const setActiveCallId = useCallStore((s) => s.setActiveCallId)
  const setRemoteStream = useCallStore((s) => s.setRemoteStream)
  const setVoiceUnavailable = useCallStore((s) => s.setVoiceUnavailable)
  const clearCall = useCallStore((s) => s.clearCall)
  const activeCallId = useCallStore((s) => s.activeCallId)
  const handlerRef = useRef<(event: WsInboundEvent) => void>(() => {})
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const pendingOfferRef = useRef<{ call_id: string; sdp: string } | null>(null)

  const cleanupWebRTC = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    setRemoteStream(null)
  }, [setRemoteStream])

  useEffect(() => {
    handlerRef.current = (event: WsInboundEvent) => {
      const t = (event as { type: string }).type
      if (!CALL_EVENT_TYPES.has(t)) return

      if (t === 'call.incoming') {
        const e = event as {
          type: 'call.incoming'
          call_id: string
          admin_user_id: string
          admin_display_name?: string
        }
        setIncomingCall({
          call_id: e.call_id,
          admin_user_id: e.admin_user_id,
          admin_display_name: e.admin_display_name,
        })
      } else if (t === 'call.ended') {
        cleanupWebRTC()
        clearCall()
      } else if (t === 'call.error') {
        cleanupWebRTC()
        clearCall()
      } else if (t === 'call.webrtc.offer') {
        const e = event as { type: 'call.webrtc.offer'; call_id: string; sdp: string }
        if (e.call_id !== activeCallId) return
        const pc = pcRef.current
        const applyOffer = (p: RTCPeerConnection) => {
          p.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: e.sdp }))
            .then(() => p.createAnswer())
            .then((answer) => {
              if (!answer) return
              return p.setLocalDescription(answer)
            })
            .then(() => {
              if (!p.localDescription) return
              wsClient.send({
                type: 'call.webrtc.answer',
                call_id: e.call_id,
                sdp: p.localDescription.sdp,
              })
            })
            .catch(console.error)
        }
        if (pc) applyOffer(pc)
        else pendingOfferRef.current = { call_id: e.call_id, sdp: e.sdp }
      } else if (t === 'call.webrtc.ice') {
        const e = event as { type: 'call.webrtc.ice'; call_id: string; candidate: string }
        const pc = pcRef.current
        if (!pc || !e.candidate) return
        try {
          const candidate = JSON.parse(e.candidate) as RTCIceCandidateInit
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error)
        } catch (_) {}
      }
    }
  }, [activeCallId, setIncomingCall, clearCall, cleanupWebRTC])

  useEffect(() => {
    const unsub = wsClient.subscribe((ev) => handlerRef.current(ev))
    return () => unsub()
  }, [])

  // Start callee WebRTC when user accepts (activeCallId set)
  useEffect(() => {
    if (!activeCallId) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn('getUserMedia not available (e.g. insecure context or unsupported browser)')
      setVoiceUnavailable(true)
      return
    }
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS })
    pcRef.current = pc

    pc.ontrack = (ev) => {
      if (ev.streams[0]) setRemoteStream(ev.streams[0])
    }
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      wsClient.send({
        type: 'call.webrtc.ice',
        call_id: activeCallId,
        candidate: JSON.stringify(ev.candidate.toJSON()),
      })
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStreamRef.current = stream
        stream.getTracks().forEach((track) => pc.addTrack(track, stream))
        const pending = pendingOfferRef.current
        if (pending && pending.call_id === activeCallId) {
          pendingOfferRef.current = null
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: pending.sdp }))
            .then(() => pc.createAnswer())
            .then((answer) => (answer ? pc.setLocalDescription(answer) : undefined))
            .then(() => {
              if (pc.localDescription) {
                wsClient.send({
                  type: 'call.webrtc.answer',
                  call_id: activeCallId,
                  sdp: pc.localDescription.sdp,
                })
              }
            })
            .catch(console.error)
        }
      })
      .catch((err) => {
        console.error('User WebRTC getUserMedia failed:', err)
        cleanupWebRTC()
        setVoiceUnavailable(true)
      })

    return () => cleanupWebRTC()
  }, [activeCallId, setRemoteStream, setVoiceUnavailable, cleanupWebRTC])

  return (
    <>
      <IncomingCallModal />
      <InCallBar />
    </>
  )
}
