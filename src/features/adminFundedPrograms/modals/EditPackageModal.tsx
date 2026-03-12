import { useState, useEffect } from 'react'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { useModalStore } from '@/app/store'
import { Switch } from '@/shared/ui/Switch'
import { toast } from '@/shared/components/common'
import type { FundedPackage } from './DeletePackageModal'

interface EditPackageModalProps {
  pkg?: FundedPackage | null
  onSave: (data: Omit<FundedPackage, 'id'> & { id?: string }) => void
  modalKey: string
  isEdit: boolean
}

const TIER_OPTIONS = ['Entry', 'Standard', 'Pro', 'Elite']

export function EditPackageModal({ pkg, onSave, modalKey, isEdit }: EditPackageModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [name, setName] = useState(pkg?.name ?? '')
  const [accountSize, setAccountSize] = useState(pkg?.accountSize?.toString() ?? '')
  const [fee, setFee] = useState(pkg?.fee?.toString() ?? '')
  const [tier, setTier] = useState(pkg?.tier ?? 'Standard')
  const [notes, setNotes] = useState(pkg?.notes ?? '')
  const [active, setActive] = useState(pkg?.active ?? true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (pkg) {
      setName(pkg.name)
      setAccountSize(String(pkg.accountSize))
      setFee(String(pkg.fee))
      setTier(pkg.tier)
      setNotes(pkg.notes)
      setActive(pkg.active)
    }
  }, [pkg])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nameTrim = name.trim()
    if (!nameTrim) {
      toast.error('Name is required.')
      return
    }
    const size = parseInt(accountSize, 10)
    const feeNum = parseInt(fee, 10)
    if (isNaN(size) || size <= 0) {
      toast.error('Account size must be a positive number.')
      return
    }
    if (isNaN(feeNum) || feeNum < 0) {
      toast.error('Fee must be 0 or greater.')
      return
    }
    setIsSubmitting(true)
    try {
      onSave({
        ...(pkg?.id && { id: pkg.id }),
        name: nameTrim,
        accountSize: size,
        fee: feeNum,
        tier: tier.trim() || 'Standard',
        notes: notes.trim(),
        active,
      })
      toast.success(isEdit ? 'Package updated.' : 'Package created.')
      closeModal(modalKey)
    } catch {
      // parent handles
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="pkg-name">Name *</Label>
        <Input
          id="pkg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard"
          className="mt-1"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="pkg-size">Account size ($) *</Label>
          <Input
            id="pkg-size"
            type="number"
            min={1}
            value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)}
            placeholder="50000"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="pkg-fee">Fee ($) *</Label>
          <Input
            id="pkg-fee"
            type="number"
            min={0}
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="249"
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="pkg-tier">Tier</Label>
        <select
          id="pkg-tier"
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="mt-1 flex h-10 w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {TIER_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="pkg-notes">Notes</Label>
        <Input
          id="pkg-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Popular"
          className="mt-1"
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
        <Label htmlFor="pkg-active" className="mb-0">Active</Label>
        <Switch id="pkg-active" checked={active} onCheckedChange={setActive} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => closeModal(modalKey)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  )
}
