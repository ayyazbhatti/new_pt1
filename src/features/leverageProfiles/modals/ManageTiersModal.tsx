import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { LeverageProfile, LeverageTier } from '../types/leverageProfile'
import { useLeverageProfileTiers, useCreateLeverageTier, useUpdateLeverageTier, useDeleteLeverageTier, leverageProfilesQueryKeys } from '../hooks/useLeverageProfiles'
import { useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '../utils/format'
import { Settings, Plus, Trash2, X } from 'lucide-react'
import { toast } from '@/shared/components/common'
import { Spinner } from '@/shared/ui/loading'

export interface TierRow {
  id?: string
  marginFrom: number
  marginTo: number
  maxLeverage: number
  sortIndex: number
  errors?: string[]
}

interface ManageTiersModalProps {
  profile: LeverageProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}

function defaultMarginPercents(maxLeverage: number) {
  const initial = maxLeverage >= 1 ? (100 / maxLeverage).toFixed(4) : '0.2'
  const maintenance = maxLeverage >= 1 ? (50 / maxLeverage).toFixed(4) : '0.1'
  return { initial, maintenance }
}

export function ManageTiersModal({ profile, open, onOpenChange }: ManageTiersModalProps) {
  const queryClient = useQueryClient()
  const { data: existingTiers, isLoading: tiersLoading } = useLeverageProfileTiers(profile.id, open)
  const createTier = useCreateLeverageTier()
  const updateTier = useUpdateLeverageTier()
  const deleteTier = useDeleteLeverageTier()

  const [rows, setRows] = useState<TierRow[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !existingTiers) return
    setRows(
      existingTiers
        .map((t) => ({
          id: t.id,
          marginFrom: Number(t.notionalFrom) || 0,
          marginTo: t.notionalTo != null ? Number(t.notionalTo) : 0,
          maxLeverage: t.maxLeverage || 100,
          sortIndex: t.tierIndex || 0,
        }))
        .sort((a, b) => a.marginFrom - b.marginFrom)
        .map((r, i) => ({ ...r, sortIndex: i + 1 }))
    )
    setValidationErrors([])
  }, [open, existingTiers])

  const validate = (): boolean => {
    const errs: string[] = []
    const rowErrs: string[][] = rows.map(() => [])
    rows.forEach((r, i) => {
      if (r.marginFrom < 0) rowErrs[i].push('Margin From must be ≥ 0')
      if (r.marginTo <= r.marginFrom) rowErrs[i].push('Margin To must be > Margin From')
      if (r.maxLeverage < 1) rowErrs[i].push('Max Leverage must be ≥ 1')
    })
    const sorted = [...rows].sort((a, b) => a.marginFrom - b.marginFrom)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].marginFrom < sorted[i - 1].marginTo) {
        errs.push(`Overlap: row ${i + 1} Margin From (${formatCurrency(sorted[i].marginFrom)}) is less than previous Margin To`)
      }
    }
    setValidationErrors(errs)
    setRows((prev) => prev.map((r, i) => ({ ...r, errors: rowErrs[i] })))
    return errs.length === 0 && rowErrs.every((e) => e.length === 0)
  }

  const handleAddRow = () => {
    const nextFrom = rows.length > 0 ? Math.max(...rows.map((r) => r.marginTo)) + 1 : 0
    setRows((prev) => [...prev, { marginFrom: nextFrom, marginTo: nextFrom + 10000, maxLeverage: 100, sortIndex: prev.length + 1 }])
  }

  const handleAutoSort = () => {
    setRows((prev) => {
      const sorted = [...prev].sort((a, b) => a.marginFrom - b.marginFrom)
      return sorted.map((r, i) => ({ ...r, sortIndex: i + 1 }))
    })
  }

  const handleRemoveRow = (index: number) => {
    if (rows.length <= 1) return
    setRows((prev) => prev.filter((_, i) => i !== index).map((r, i) => ({ ...r, sortIndex: i + 1 })))
  }

  const handleSave = async () => {
    if (!validate()) {
      toast.error('Please fix validation errors before saving.')
      return
    }
    setSaving(true)
    try {
      const existingIds = new Set((existingTiers ?? []).map((t) => t.id))
      const rowIds = new Set(rows.map((r) => r.id).filter(Boolean) as string[])
      const toDelete = [...existingIds].filter((id) => !rowIds.has(id))
      for (const id of toDelete) {
        await deleteTier.mutateAsync({ profileId: profile.id, tierId: id })
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const { initial, maintenance } = defaultMarginPercents(r.maxLeverage)
        if (r.id && existingTiers?.some((t) => t.id === r.id)) {
          await updateTier.mutateAsync({
            profileId: profile.id,
            tierId: r.id,
            payload: {
              tier_index: r.sortIndex,
              notional_from: String(r.marginFrom),
              notional_to: r.marginTo > 0 ? String(r.marginTo) : null,
              max_leverage: r.maxLeverage,
              initial_margin_percent: initial,
              maintenance_margin_percent: maintenance,
            },
          })
        } else if (!r.id) {
          await createTier.mutateAsync({
            profileId: profile.id,
            payload: {
              tier_index: r.sortIndex,
              notional_from: String(r.marginFrom),
              notional_to: r.marginTo > 0 ? String(r.marginTo) : null,
              max_leverage: r.maxLeverage,
              initial_margin_percent: initial,
              maintenance_margin_percent: maintenance,
            },
          })
        }
      }
      queryClient.invalidateQueries({ queryKey: leverageProfilesQueryKeys.tiers(profile.id) })
      queryClient.invalidateQueries({ queryKey: leverageProfilesQueryKeys.lists() })
      toast.success('Tiers saved.')
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save tiers')
    } finally {
      setSaving(false)
    }
  }

  const updateRow = (index: number, field: keyof TierRow, value: number) => {
    setRows((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const hasErrors = validationErrors.length > 0 || rows.some((r) => r.errors && r.errors.length > 0)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
      <div className="bg-slate-800 rounded-lg border border-slate-700 max-w-4xl lg:max-w-6xl w-full max-h-[90vh] flex flex-col shadow-xl my-8">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings className="h-5 w-5 text-slate-400" />
              Manage Tiers — {profile.name}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">Configure margin ranges and leverage limits for this profile.</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-white p-1 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {tiersLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-8 w-8 text-slate-400" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Button type="button" size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleAddRow}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Row
                </Button>
                <Button type="button" size="sm" variant="outline" className="border-slate-600 bg-slate-700 text-slate-300" onClick={handleAutoSort}>
                  Auto-Sort
                </Button>
                <Button type="button" size="sm" variant="outline" className="border-slate-600 bg-slate-700 text-slate-300" onClick={() => validate()}>
                  Validate
                </Button>
                <span className="text-sm text-slate-400 ml-2">{rows.length} tier(s)</span>
              </div>

              {validationErrors.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30">
                  <p className="text-sm font-medium text-red-400">Validation Errors</p>
                  <ul className="text-sm text-slate-300 mt-1 list-disc list-inside">
                    {validationErrors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 border-b border-slate-700">
                      <th className="text-left p-3 text-slate-400 font-medium w-12">#</th>
                      <th className="text-left p-3 text-slate-400 font-medium">Margin From (USD)</th>
                      <th className="text-left p-3 text-slate-400 font-medium">Margin To (USD)</th>
                      <th className="text-left p-3 text-slate-400 font-medium">Max Leverage (x)</th>
                      <th className="text-left p-3 text-slate-400 font-medium w-20">Order</th>
                      <th className="w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={row.id ?? index} className="border-b border-slate-700 last:border-0">
                        <td className="p-3 text-slate-300">{index + 1}</td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={0}
                            value={row.marginFrom}
                            onChange={(e) => updateRow(index, 'marginFrom', Number(e.target.value) || 0)}
                            className="w-28 border-slate-600 bg-slate-700 text-white"
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={0}
                            value={row.marginTo}
                            onChange={(e) => updateRow(index, 'marginTo', Number(e.target.value) || 0)}
                            className="w-28 border-slate-600 bg-slate-700 text-white"
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            min={1}
                            value={row.maxLeverage}
                            onChange={(e) => updateRow(index, 'maxLeverage', Number(e.target.value) || 1)}
                            className="w-24 border-slate-600 bg-slate-700 text-white"
                          />
                        </td>
                        <td className="p-3 text-slate-300">{row.sortIndex}</td>
                        <td className="p-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-slate-400 hover:text-red-400 p-2"
                            onClick={() => handleRemoveRow(index)}
                            disabled={rows.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between p-4 sm:p-6 border-t border-slate-700">
          <p className="text-sm text-slate-400">{hasErrors ? 'Please fix errors before saving.' : 'Ready to save.'}</p>
          <div className="flex gap-2">
            <Button variant="outline" className="border-slate-600 bg-slate-700 text-slate-300" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={saving || hasErrors || tiersLoading}>
              {saving ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Saving...
                </>
              ) : (
                'Save Tiers'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
