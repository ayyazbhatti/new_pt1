import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ContentShell, PageHeader } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui'
import { DataTable, type ColumnDef } from '@/shared/ui/table'
import { searchUsersForAppointment } from '@/features/appointments/api/appointments.api'
import type { UserSearchResult } from '@/features/appointments/types'
import { wsClient } from '@/shared/ws/wsClient'
import type { WsInboundEvent } from '@/shared/ws/wsEvents'
import { useAuthStore } from '@/shared/store/auth.store'
import { getCallRecords, type CallRecordRow } from '../api/callRecords.api'
import { playRingtone } from '@/features/call/playRingtone'
import { Phone, PhoneOff, Loader2, Bell } from 'lucide-react'
import { format } from 'date-fns'

type CallStatus = 'idle' | 'ringing' | 'connected' | 'declined' | 'error'

const SEARCH_DEBOUNCE_MS = 300
const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export function AdminCallUserPage() {
  const user = useAuthStore((s) => s.user)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [currentCallId, setCurrentCallId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [callRecords, setCallRecords] = useState<CallRecordRow[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsPage, setRecordsPage] = useState(0)
  const [recordsPageSize, setRecordsPageSize] = useState(20)
  const [ringTestPlaying, setRingTestPlaying] = useState(false)
  const ringTestStopRef = useRef<(() => void) | null>(null)
  const ringTestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  const cleanupWebRTC = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    setRemoteStream(null)
  }, [])

  // Debounced user search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      searchUsersForAppointment(searchQuery.trim(), 15)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => {
          setSearching(false)
          debounceRef.current = null
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery])

  const handleWsEvent = useCallback((event: WsInboundEvent) => {
    const t = (event as { type: string }).type
    if (t === 'call.ringing') {
      const e = event as { type: 'call.ringing'; call_id: string; target_user_id: string }
      setCurrentCallId(e.call_id)
      setTargetUserId(e.target_user_id)
      setStatus('ringing')
      setErrorMessage(null)
    } else if (t === 'call.accepted') {
      setStatus('connected')
      setErrorMessage(null)
    } else if (t === 'call.rejected') {
      setStatus('declined')
      setErrorMessage(null)
    } else if (t === 'call.ended') {
      cleanupWebRTC()
      setStatus('idle')
      setCurrentCallId(null)
      setTargetUserId(null)
      setErrorMessage(null)
    } else if (t === 'call.error') {
      cleanupWebRTC()
      const e = event as { type: 'call.error'; message: string }
      setErrorMessage(e.message)
      setStatus('error')
      setCurrentCallId(null)
      setTargetUserId(null)
    } else if (t === 'call.webrtc.answer') {
      const e = event as { type: 'call.webrtc.answer'; call_id: string; sdp: string }
      const pc = pcRef.current
      if (!pc) return
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: e.sdp })).catch(console.error)
    } else if (t === 'call.webrtc.ice') {
      const e = event as { type: 'call.webrtc.ice'; call_id: string; candidate: string }
      const pc = pcRef.current
      if (!pc || !e.candidate) return
      try {
        const candidate = JSON.parse(e.candidate) as RTCIceCandidateInit
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error)
      } catch (_) {}
    }
  }, [cleanupWebRTC])

  useEffect(() => {
    const unsub = wsClient.subscribe(handleWsEvent)
    return () => unsub()
  }, [handleWsEvent])

  // Start WebRTC as caller when connected (user accepted)
  useEffect(() => {
    if (status !== 'connected' || !currentCallId) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn('getUserMedia not available (e.g. insecure context or unsupported browser)')
      cleanupWebRTC()
      return
    }
    let cancelled = false
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS })
    pcRef.current = pc

    pc.ontrack = (ev) => {
      if (!cancelled && ev.streams[0]) setRemoteStream(ev.streams[0])
    }
    pc.onicecandidate = (ev) => {
      if (!ev.candidate || cancelled) return
      wsClient.send({
        type: 'call.webrtc.ice',
        call_id: currentCallId,
        candidate: JSON.stringify(ev.candidate.toJSON()),
      })
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        localStreamRef.current = stream
        stream.getTracks().forEach((track) => pc.addTrack(track, stream))
        return pc.createOffer()
      })
      .then((offer) => {
        if (cancelled || !offer) return
        return pc.setLocalDescription(offer)
      })
      .then(() => {
        if (cancelled || !pc.localDescription) return
        wsClient.send({
          type: 'call.webrtc.offer',
          call_id: currentCallId,
          sdp: pc.localDescription.sdp,
        })
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Admin WebRTC start failed:', err)
          cleanupWebRTC()
        }
      })

    cleanupRef.current = () => {
      cancelled = true
    }
    return () => cleanupWebRTC()
  }, [status, currentCallId, cleanupWebRTC])

  const handleCall = () => {
    if (!selectedUser) return
    setStatus('ringing')
    setTargetUserId(selectedUser.id)
    setErrorMessage(null)
    const displayName = user?.name ?? ([user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined)
    wsClient.send({
      type: 'call.initiate',
      target_user_id: selectedUser.id,
      caller_display_name: displayName,
    })
  }

  const handleEndCall = () => {
    if (currentCallId) {
      cleanupWebRTC()
      wsClient.send({ type: 'call.end', call_id: currentCallId })
      setCurrentCallId(null)
      setStatus('idle')
    }
  }

  const handleCancelRinging = () => {
    if (currentCallId) {
      wsClient.send({ type: 'call.end', call_id: currentCallId })
      setCurrentCallId(null)
      setStatus('idle')
    }
  }

  const displayName = (u: UserSearchResult) =>
    u.full_name ?? ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || u.id)

  /** Call again the user from a call history record (sets selected user and initiates call). */
  const handleCallAgain = useCallback(
    (record: CallRecordRow) => {
      const recordAsUser: UserSearchResult = {
        id: record.userId,
        email: record.userEmail ?? '',
        full_name: record.userDisplayName ?? undefined,
      }
      setSelectedUser(recordAsUser)
      setStatus('ringing')
      setTargetUserId(record.userId)
      setErrorMessage(null)
      const displayNameStr = user?.name ?? ([user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined)
      wsClient.send({
        type: 'call.initiate',
        target_user_id: record.userId,
        caller_display_name: displayNameStr,
      })
    },
    [user?.name, user?.firstName, user?.lastName]
  )

  const fetchCallRecords = useCallback(async () => {
    setRecordsLoading(true)
    try {
      const res = await getCallRecords({
        limit: recordsPageSize,
        offset: recordsPage * recordsPageSize,
      })
      setCallRecords(res.records)
      setRecordsTotal(res.total)
    } catch {
      setCallRecords([])
      setRecordsTotal(0)
    } finally {
      setRecordsLoading(false)
    }
  }, [recordsPage, recordsPageSize])

  useEffect(() => {
    fetchCallRecords()
  }, [fetchCallRecords])

  const prevStatusRef = useRef<CallStatus>('idle')
  useEffect(() => {
    const wasInCall = prevStatusRef.current !== 'idle'
    prevStatusRef.current = status
    if (wasInCall && status === 'idle') {
      fetchCallRecords()
    }
  }, [status, fetchCallRecords])

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  const callHistoryColumns = useMemo<ColumnDef<CallRecordRow>[]>(
    () => [
      {
        accessorKey: 'initiatedAt',
        header: 'Initiated at',
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">
            {format(new Date(row.original.initiatedAt), 'MMM d, yyyy HH:mm:ss')}
          </span>
        ),
      },
      {
        accessorKey: 'adminDisplayName',
        header: 'Admin',
        cell: ({ row }) => (
          <span className="text-sm" title={row.original.adminEmail ?? undefined}>
            {row.original.adminDisplayName || row.original.adminEmail || row.original.adminUserId}
          </span>
        ),
      },
      {
        accessorKey: 'userDisplayName',
        header: 'User (callee)',
        cell: ({ row }) => (
          <span className="text-sm" title={row.original.userEmail ?? undefined}>
            {row.original.userDisplayName || row.original.userEmail || row.original.userId}
          </span>
        ),
      },
      {
        accessorKey: 'userEmail',
        header: 'Email',
        cell: ({ row }) => (
          <span className="text-sm text-text-muted whitespace-nowrap">
            {row.original.userEmail ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className="text-sm capitalize">{row.original.status}</span>
        ),
      },
      {
        id: 'duration',
        header: 'Duration',
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">
            {row.original.durationSeconds != null
              ? `${Math.floor(row.original.durationSeconds / 60)}m ${row.original.durationSeconds % 60}s`
              : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'endedBy',
        header: 'Ended by',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.endedBy ?? '—'}</span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()} data-no-row-click>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCallAgain(row.original)}
              disabled={status !== 'idle'}
              className="gap-1.5"
              title="Call this user again"
            >
              <Phone className="h-3.5 w-3.5" />
              Call again
            </Button>
          </div>
        ),
      },
    ],
    [status, handleCallAgain]
  )

  const handleRingTest = () => {
    if (ringTestPlaying) {
      if (ringTestTimeoutRef.current) {
        clearTimeout(ringTestTimeoutRef.current)
        ringTestTimeoutRef.current = null
      }
      ringTestStopRef.current?.()
      ringTestStopRef.current = null
      setRingTestPlaying(false)
      return
    }
    const stop = playRingtone({ durationMs: 6000 })
    ringTestStopRef.current = stop
    setRingTestPlaying(true)
    ringTestTimeoutRef.current = setTimeout(() => {
      ringTestTimeoutRef.current = null
      setRingTestPlaying(false)
      ringTestStopRef.current = null
    }, 6000)
  }

  return (
    <ContentShell>
      <PageHeader
        title="Call user"
        description="Select a user and start a call. They will see an incoming call and can accept or reject."
      />
      <div className="space-y-6 w-full">
        {/* Ring test: same sound the user hears on incoming call */}
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-2/50">
          <Bell className="h-5 w-5 text-muted" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Ring test</p>
            <p className="text-xs text-muted">
              Play the same ring the user hears when you call. Use this to verify audio works. If the user does not hear the ring, ask them to click or tap anywhere on the page first (browser requirement).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRingTest}
            className="gap-1.5 shrink-0"
          >
            {ringTestPlaying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Stop
              </>
            ) : (
              <>
                <Bell className="h-4 w-4" />
                Play ring
              </>
            )}
          </Button>
        </div>

        {/* User search */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-muted">Search user</label>
          <Input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
          {searching && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching...
            </p>
          )}
          {searchQuery.trim() && !searching && (
            <ul className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto bg-surface">
              {searchResults.length === 0 ? (
                <li className="px-4 py-3 text-sm text-text-muted">No users found</li>
              ) : (
                searchResults.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUser(u)
                        setSearchQuery('')
                        setSearchResults([])
                      }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-surface-2 flex flex-col"
                    >
                      <span className="font-medium">{displayName(u)}</span>
                      <span className="text-text-muted text-xs">{u.email}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {/* Selected user & Call */}
        {selectedUser && (
          <div className="p-4 rounded-lg border border-border bg-surface-2 space-y-3">
            <p className="text-sm text-text-muted">Selected user</p>
            <p className="font-medium">{displayName(selectedUser)}</p>
            <p className="text-sm text-text-muted">{selectedUser.email}</p>
            {status === 'idle' && (
              <Button onClick={handleCall} className="gap-2">
                <Phone className="h-4 w-4" />
                Call
              </Button>
            )}
          </div>
        )}

        {/* Call state */}
        {status === 'ringing' && (
          <div className="p-4 rounded-lg border border-border bg-surface-2 space-y-2">
            <p className="flex items-center gap-2 text-amber-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Ringing...
            </p>
            <Button variant="outline" size="sm" onClick={handleCancelRinging}>
              Cancel
            </Button>
          </div>
        )}
        {status === 'connected' && (
          <div className="p-4 rounded-lg border border-border bg-surface-2 space-y-2">
            <p className="text-success">Connected</p>
            {remoteStream && <audio ref={remoteAudioRef} autoPlay playsInline />}
            <Button variant="danger" size="sm" onClick={handleEndCall} className="gap-2">
              <PhoneOff className="h-4 w-4" />
              End call
            </Button>
          </div>
        )}
        {status === 'declined' && (
          <div className="p-4 rounded-lg border border-border bg-surface-2">
            <p className="text-amber-600">User declined</p>
            <Button variant="outline" size="sm" onClick={() => setStatus('idle')}>
              OK
            </Button>
          </div>
        )}
        {status === 'error' && errorMessage && (
          <div className="p-4 rounded-lg border border-border bg-surface-2">
            <p className="text-danger">{errorMessage}</p>
            <Button variant="outline" size="sm" onClick={() => setStatus('idle')}>
              OK
            </Button>
          </div>
        )}

        {/* Call history table - same DataTable as admin Users page */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Call history</h2>
          {recordsLoading && callRecords.length === 0 ? (
            <div className="rounded-lg border border-border p-8 text-center text-text-muted flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading records...
            </div>
          ) : callRecords.length === 0 && recordsTotal === 0 ? (
            <div className="rounded-lg border border-border p-8 text-center text-text-muted">
              No call records yet.
            </div>
          ) : (
            <DataTable<CallRecordRow>
              data={callRecords}
              columns={callHistoryColumns}
              pagination={{
                page: recordsPage + 1,
                pageSize: recordsPageSize,
                total: recordsTotal,
                onPageChange: (p) => setRecordsPage(p - 1),
                onPageSizeChange: (size) => {
                  setRecordsPageSize(size)
                  setRecordsPage(0)
                },
              }}
            />
          )}
        </div>
      </div>
    </ContentShell>
  )
}
