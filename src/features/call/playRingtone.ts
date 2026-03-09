/**
 * Play the same two-tone ring used for incoming calls.
 * Call from a user gesture (e.g. button click) so the browser allows audio.
 * Returns a function to stop the ring early.
 */
export function playRingtone(options?: { durationMs?: number }): () => void {
  const durationMs = options?.durationMs ?? 0
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
  if (!Ctx) return () => {}

  const ctx = new Ctx()
  let intervalId: ReturnType<typeof setInterval> | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

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

  const stop = () => {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (ctx.state !== 'closed') {
      ctx.close().catch(() => {})
    }
  }

  ctx.resume().then(() => {
    ring()
    intervalId = setInterval(ring, 2000)
    if (durationMs > 0) {
      timeoutId = setTimeout(stop, durationMs)
    }
  }).catch(() => {})

  return stop
}
