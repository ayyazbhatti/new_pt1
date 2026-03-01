import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useCreateAffiliateLayer, useUpdateAffiliateLayer } from '../hooks/useAffiliateLayers'
import type { AffiliateLayer } from '../api/affiliateLayers.api'
import { toast } from '@/shared/components/common'

interface CreateEditSchemeModalProps {
  layer?: AffiliateLayer | null
  onClose: () => void
}

export function CreateEditSchemeModal({ layer, onClose }: CreateEditSchemeModalProps) {
  const isEdit = !!layer
  const [name, setName] = useState(layer?.name ?? '')
  const [levels, setLevels] = useState<{ level: number; percent: number }[]>(
    layer ? [{ level: 1, percent: layer.commissionPercent }] : [{ level: 1, percent: 0 }]
  )

  const createMutation = useCreateAffiliateLayer()
  const updateMutation = useUpdateAffiliateLayer()

  const handleAddLevel = () => {
    setLevels((prev) => [...prev, { level: prev.length + 1, percent: 0 }])
  }

  const handleRemoveLevel = (index: number) => {
    if (levels.length <= 1) return
    setLevels((prev) => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, level: i + 1 })))
  }

  const handleLevelPercentChange = (index: number, value: number) => {
    setLevels((prev) =>
      prev.map((l, i) => (i === index ? { ...l, percent: value } : l))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Name is required')
      return
    }
    if (isEdit && layer) {
      const firstLevel = levels[0]
      await updateMutation.mutateAsync({
        id: layer.id,
        payload: { name: trimmedName, commission_percent: firstLevel?.percent ?? 0 },
      })
      toast.success('Scheme updated')
    } else {
      const firstLevel = levels[0]
      await createMutation.mutateAsync({
        name: trimmedName,
        commission_percent: firstLevel?.percent ?? 0,
      })
      toast.success('Scheme created')
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-4 sm:p-6 w-full max-w-2xl border border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-white">
            {isEdit ? 'Edit Affiliate Scheme' : 'Create Affiliate Scheme'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Scheme name"
              className="w-full px-3 sm:px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Min Active Users</label>
              <input
                type="number"
                min={0}
                className="w-full px-3 sm:px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm sm:text-base"
                readOnly
                value={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Min Volume</label>
              <input
                type="number"
                min={0}
                className="w-full px-3 sm:px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm sm:text-base"
                readOnly
                value={0}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Cookie Days</label>
            <input
              type="number"
              min={0}
              className="w-full px-3 sm:px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm sm:text-base"
              readOnly
              value={0}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300">Commission Levels</label>
              <button
                type="button"
                onClick={handleAddLevel}
                className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm sm:text-base"
              >
                Add Level
              </button>
            </div>
            <div className="space-y-2">
              {levels.map((lev, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={1}
                    value={lev.level}
                    readOnly
                    className="w-16 sm:w-20 px-2 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                  />
                  <span className="text-slate-400">:</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={100}
                    value={lev.percent}
                    onChange={(e) => handleLevelPercentChange(index, parseFloat(e.target.value) || 0)}
                    className="w-20 sm:w-24 px-2 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                  />
                  <span className="text-slate-400">%</span>
                  {levels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveLevel(index)}
                      className="p-2 text-red-500 hover:bg-slate-700 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:space-x-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              {isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
