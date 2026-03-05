import { create } from 'zustand'

export interface IncomingCall {
  call_id: string
  admin_user_id: string
  admin_display_name?: string
}

interface CallState {
  /** When user receives call.incoming */
  incomingCall: IncomingCall | null
  /** When user has accepted, so we show "In call" bar */
  activeCallId: string | null
  /** Remote audio stream (for playing admin's voice) */
  remoteStream: MediaStream | null
  /** True when mic/voice failed (e.g. HTTP context) but call is still connected */
  voiceUnavailable: boolean
  setIncomingCall: (call: IncomingCall | null) => void
  setActiveCallId: (id: string | null) => void
  setRemoteStream: (stream: MediaStream | null) => void
  setVoiceUnavailable: (v: boolean) => void
  clearCall: () => void
}

export const useCallStore = create<CallState>((set) => ({
  incomingCall: null,
  activeCallId: null,
  remoteStream: null,
  voiceUnavailable: false,
  setIncomingCall: (incomingCall) => set({ incomingCall }),
  setActiveCallId: (activeCallId) => set({ activeCallId }),
  setRemoteStream: (remoteStream) => set({ remoteStream }),
  setVoiceUnavailable: (voiceUnavailable) => set({ voiceUnavailable }),
  clearCall: () => set({ incomingCall: null, activeCallId: null, remoteStream: null, voiceUnavailable: false }),
}))
