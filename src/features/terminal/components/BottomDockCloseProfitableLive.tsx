import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { TrendingUp } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { closePosition, type Position } from '../api/positions.api'
import { useSymbolPrice, normalizeSymbolKey } from '@/features/symbols/hooks/usePriceStream'
import { openPositionPnlParts } from '@/shared/components/PositionPnLBreakdown'

function canonicalPositionId(id: string): string {
  return id.trim().toLowerCase()
}

function closePositionErrorMessage(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { error?: { message?: string } }; status?: number }
    message?: string
  }
  const apiMessage = anyErr.response?.data?.error?.message
  if (apiMessage) return apiMessage
  if (anyErr.response?.status === 403 || (typeof anyErr.message === 'string' && anyErr.message.includes('403'))) {
    return 'Trading is disabled. You cannot close positions.'
  }
  return err instanceof Error ? err.message : 'Failed to close position'
}

function PositionNetReporter({
  position,
  onNet,
}: {
  position: Position
  onNet: (canonicalId: string, net: number) => void
}) {
  const feedKey = normalizeSymbolKey(position.symbol)
  const price = useSymbolPrice(feedKey)
  const sizeNum = parseFloat(position.size || '0')
  const entryPrice = parseFloat(position.avg_price || position.entry_price || '0')
  const livePrice = price
    ? position.side === 'LONG'
      ? parseFloat(price.bid)
      : parseFloat(price.ask)
    : null
  const { net } = openPositionPnlParts(position, livePrice, sizeNum, entryPrice)
  const cid = canonicalPositionId(position.id)

  useEffect(() => {
    onNet(cid, net)
  }, [cid, net, onNet])

  return null
}

/**
 * Tracks whether any open position has positive unrealized net PnL, updating the parent only when
 * that boolean crosses (avoids BottomDock re-rendering on every tick).
 */
export function BottomDockLiveProfitablePresence({
  positions,
  onHasProfitableChange,
}: {
  positions: Position[]
  onHasProfitableChange: (has: boolean) => void
}) {
  const profitableIdsRef = useRef(new Set<string>())
  const hasStateRef = useRef(false)

  const onNet = useCallback(
    (canonicalId: string, net: number) => {
      const nowProf = Number.isFinite(net) && net > 0
      const wasProf = profitableIdsRef.current.has(canonicalId)
      if (nowProf === wasProf) return
      if (nowProf) profitableIdsRef.current.add(canonicalId)
      else profitableIdsRef.current.delete(canonicalId)
      const has = profitableIdsRef.current.size > 0
      if (has !== hasStateRef.current) {
        hasStateRef.current = has
        onHasProfitableChange(has)
      }
    },
    [onHasProfitableChange],
  )

  useEffect(() => {
    const allowed = new Set(positions.map((p) => canonicalPositionId(p.id)))
    let dirty = false
    for (const id of [...profitableIdsRef.current]) {
      if (!allowed.has(id)) {
        profitableIdsRef.current.delete(id)
        dirty = true
      }
    }
    if (!dirty) return
    const has = profitableIdsRef.current.size > 0
    if (has !== hasStateRef.current) {
      hasStateRef.current = has
      onHasProfitableChange(has)
    }
  }, [positions, onHasProfitableChange])

  return (
    <>
      {positions.map((p) => (
        <PositionNetReporter key={p.id} position={p} onNet={onNet} />
      ))}
    </>
  )
}

export function BottomDockCloseProfitableOnlyDialogBody({
  openPositions,
  closeProfitableOnlyLoading,
  setCloseProfitableOnlyLoading,
  onCloseDialog,
  positionCloseTombstonesRef,
  setPositions,
  fetchOpenPositions,
}: {
  openPositions: Position[]
  closeProfitableOnlyLoading: boolean
  setCloseProfitableOnlyLoading: (v: boolean) => void
  onCloseDialog: () => void
  positionCloseTombstonesRef: MutableRefObject<Map<string, number>>
  setPositions: Dispatch<SetStateAction<Position[]>>
  fetchOpenPositions: (silent?: boolean) => Promise<unknown>
}) {
  const profitableIdsRef = useRef(new Set<string>())
  const [profitableCount, setProfitableCount] = useState(0)

  const onNet = useCallback((canonicalId: string, net: number) => {
    const nowProf = Number.isFinite(net) && net > 0
    const wasProf = profitableIdsRef.current.has(canonicalId)
    if (nowProf === wasProf) return
    if (nowProf) profitableIdsRef.current.add(canonicalId)
    else profitableIdsRef.current.delete(canonicalId)
    setProfitableCount(profitableIdsRef.current.size)
  }, [])

  useEffect(() => {
    const allowed = new Set(openPositions.map((p) => canonicalPositionId(p.id)))
    let dirty = false
    for (const id of [...profitableIdsRef.current]) {
      if (!allowed.has(id)) {
        profitableIdsRef.current.delete(id)
        dirty = true
      }
    }
    if (dirty) setProfitableCount(profitableIdsRef.current.size)
  }, [openPositions])

  const descriptionText =
    profitableCount === 0
      ? 'No profitable positions to close.'
      : `Close ${profitableCount} position(s) with positive unrealized PnL? This action cannot be undone.`

  return (
    <>
      <Dialog.Title className="text-lg font-semibold text-text mb-2 flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-success" />
        Close only profitable positions
      </Dialog.Title>
      <Dialog.Description className="text-sm text-slate-600 dark:text-muted mb-6">{descriptionText}</Dialog.Description>
      {openPositions.map((p) => (
        <PositionNetReporter key={p.id} position={p} onNet={onNet} />
      ))}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => onCloseDialog()}
          disabled={closeProfitableOnlyLoading}
          className="px-4 py-2 text-sm text-text hover:bg-surface-2 rounded transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={async () => {
            const toClose = openPositions.filter((p) => profitableIdsRef.current.has(canonicalPositionId(p.id)))
            if (toClose.length === 0) {
              onCloseDialog()
              return
            }
            setCloseProfitableOnlyLoading(true)
            let closed = 0
            const failedPositions: { id: string; symbol: string; error: string }[] = []
            try {
              for (const pos of toClose) {
                try {
                  const pk = canonicalPositionId(pos.id)
                  flushSync(() => {
                    positionCloseTombstonesRef.current.set(pk, Date.now())
                    setPositions((prev) => prev.filter((p) => canonicalPositionId(p.id) !== pk))
                  })
                  await closePosition(pos.id)
                  closed++
                } catch (err: unknown) {
                  positionCloseTombstonesRef.current.delete(canonicalPositionId(pos.id))
                  void fetchOpenPositions(true)
                  failedPositions.push({ id: pos.id, symbol: pos.symbol, error: closePositionErrorMessage(err) })
                }
              }
              if (closed > 0) {
                toast.success(
                  closed === toClose.length
                    ? `Closed ${closed} profitable position(s)`
                    : `Closed ${closed} position(s)${failedPositions.length > 0 ? `, ${failedPositions.length} failed` : ''}`,
                )
              }
              if (failedPositions.length > 0) {
                const detail =
                  failedPositions.length === 1
                    ? `${failedPositions[0].symbol}: ${failedPositions[0].error}`
                    : `${failedPositions.length} position(s) failed to close`
                toast.error(closed === 0 ? detail : detail)
              }
              onCloseDialog()
              fetchOpenPositions(true)
            } finally {
              setCloseProfitableOnlyLoading(false)
            }
          }}
          disabled={closeProfitableOnlyLoading || profitableCount === 0}
          className="px-4 py-2 text-sm bg-success text-white hover:bg-success/90 rounded transition-colors disabled:opacity-50"
        >
          {closeProfitableOnlyLoading ? 'Closing...' : 'Close profitable'}
        </button>
      </div>
    </>
  )
}
