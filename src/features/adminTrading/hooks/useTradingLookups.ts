import { useEffect, useState } from 'react'
import { fetchAdminGroups, fetchAdminSymbols } from '../api/lookups'
import type { LookupGroup, LookupSymbol } from '../types'

export function useTradingLookups() {
  const [symbols, setSymbols] = useState<LookupSymbol[]>([])
  const [groups, setGroups] = useState<LookupGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([fetchAdminSymbols(), fetchAdminGroups()])
      .then(([sym, grp]) => {
        if (cancelled) return
        setSymbols(Array.isArray(sym) ? sym : [])
        setGroups(Array.isArray(grp) ? grp : [])
      })
      .catch(() => {
        if (!cancelled) {
          setSymbols([])
          setGroups([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { symbols, groups, loading }
}
