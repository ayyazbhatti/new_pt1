/**
 * Unlock Web Audio on first user interaction so incoming call ringtone can play.
 * Browsers block audio until the user has interacted with the page (click, tap, key).
 */

let unlockedContext: AudioContext | null = null
let listenerAttached = false

function attachUnlockListener(): void {
  if (listenerAttached || typeof document === 'undefined') return
  listenerAttached = true

  const unlock = () => {
    if (unlockedContext) return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ctx.resume().then(() => {
      unlockedContext = ctx
    }).catch(() => {})
  }

  const events = ['click', 'touchstart', 'keydown']
  const onInteraction = () => {
    unlock()
    events.forEach((ev) => document.removeEventListener(ev, onInteraction))
  }
  events.forEach((ev) => document.addEventListener(ev, onInteraction, { once: true, passive: true }))
}

/** Call when the call UI mounts so we start listening for first interaction. */
export function ensureAudioUnlockListener(): void {
  attachUnlockListener()
}

/** Get an AudioContext that can play (pre-unlocked if user has interacted, else new). */
export function getPlayableAudioContext(): { ctx: AudioContext; isShared: boolean } {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (unlockedContext && unlockedContext.state !== 'closed') {
    return { ctx: unlockedContext, isShared: true }
  }
  return { ctx: new Ctx(), isShared: false }
}
