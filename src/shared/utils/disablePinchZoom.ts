const MOBILE_BREAKPOINT = 1024

function isMobileContext(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < MOBILE_BREAKPOINT && 'ontouchstart' in window
}

/**
 * Disables pinch-to-zoom on mobile only (iOS Safari and others that ignore viewport meta).
 * - iOS: prevents gesturestart/gesturechange (Safari pinch).
 * - Android: prevents touchmove when two fingers are active.
 * Keeps single-finger scroll and tap intact. No effect on desktop.
 */
export function disablePinchZoom(): void {
  if (typeof document === 'undefined') return
  if (!isMobileContext()) return

  const preventGesture = (e: Event): void => {
    e.preventDefault()
  }

  const handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length >= 2) e.preventDefault()
  }

  // iOS Safari: gesture events (pinch zoom)
  document.addEventListener('gesturestart', preventGesture, { capture: true, passive: false })
  document.addEventListener('gesturechange', preventGesture, { capture: true, passive: false })
  document.addEventListener('gestureend', preventGesture, { capture: true, passive: false })
  // Android / Chrome: prevent two-finger pinch
  document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false })
}
