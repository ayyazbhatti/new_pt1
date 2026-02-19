import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-hot-toast'
import type { AccountSummaryResponse } from '../api'

const DEFAULT_THRESHOLD = 50
const COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Returns whether current margin level is below the group threshold (margin call),
 * and manages showing toast + modal with cooldown.
 */
export function useMarginCall(accountSummary: AccountSummaryResponse | null) {
  const [showModal, setShowModal] = useState(false)
  const lastShownRef = useRef<number>(0)
  const wasBelowRef = useRef(false)

  const threshold = accountSummary?.marginCallLevelThreshold ?? DEFAULT_THRESHOLD
  const marginLevelStr = accountSummary?.marginLevel
  const currentLevel =
    marginLevelStr != null && marginLevelStr !== 'inf'
      ? parseFloat(marginLevelStr)
      : null

  const isMarginCall =
    currentLevel != null && !Number.isNaN(currentLevel) && currentLevel < threshold

  useEffect(() => {
    if (!accountSummary || !isMarginCall) {
      if (!isMarginCall) wasBelowRef.current = false
      return
    }
    const now = Date.now()
    const cooldownPassed = now - lastShownRef.current >= COOLDOWN_MS
    if (!cooldownPassed && wasBelowRef.current) return
    wasBelowRef.current = true
    lastShownRef.current = now
    toast.error(
      `Margin call: your margin level is below ${threshold}%. Please add funds to avoid liquidation.`,
      { duration: 6000 }
    )
    setShowModal(true)
  }, [isMarginCall, threshold, accountSummary])

  return {
    isMarginCall: isMarginCall ?? false,
    showModal,
    setShowModal,
    threshold,
    currentLevel: currentLevel ?? null,
    accountSummary,
  }
}
