import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/Switch'
import { useModalStore } from '@/app/store'
import { toast } from 'react-hot-toast'
import { useState, useEffect } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { UserGroup } from '../types/group'

const groupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
  currency: z.string().min(1, 'Currency is required'),
  region: z.string().min(1, 'Region is required'),
  spreadMarkup: z.number().min(0, 'Spread markup must be 0 or greater'),
  commission: z.number().min(0, 'Commission must be 0 or greater'),
  swapProfile: z.string().min(1, 'Swap profile is required'),
  minLeverage: z.number().min(1, 'Min leverage must be at least 1'),
  maxLeverage: z.number().min(1, 'Max leverage must be at least 1'),
  maxOpenPositions: z.number().min(1, 'Max open positions must be at least 1').optional(),
  maxExposure: z.number().min(0, 'Max exposure must be 0 or greater').optional(),
})

type GroupFormData = z.infer<typeof groupSchema>

interface EditGroupModalProps {
  group: UserGroup
  readOnly?: boolean
}

export function EditGroupModal({ group, readOnly = false }: EditGroupModalProps) {
  const closeModal = useModalStore((state) => state.closeModal)
  const [status, setStatus] = useState(group.status === 'active')
  const [tradingAllowed, setTradingAllowed] = useState(group.tradingAllowed ?? true)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: group.name,
      currency: group.currency,
      region: group.region,
      spreadMarkup: group.spreadMarkup,
      commission: group.commission,
      swapProfile: group.swapProfile,
      minLeverage: group.minLeverage,
      maxLeverage: group.maxLeverage,
      maxOpenPositions: group.maxOpenPositions,
      maxExposure: group.maxExposure,
    },
  })

  useEffect(() => {
    setStatus(group.status === 'active')
    setTradingAllowed(group.tradingAllowed ?? true)
  }, [group.status, group.tradingAllowed])

  const currency = watch('currency')
  const region = watch('region')
  const swapProfile = watch('swapProfile')

  const onSubmit = (data: GroupFormData) => {
    toast.success(`Group "${data.name}" updated successfully`)
    closeModal(`edit-group-${group.id}`)
  }

  const modalKey = readOnly ? `view-group-${group.id}` : `edit-group-${group.id}`

  return (
    <Tabs.Root defaultValue="general" className="w-full">
      <Tabs.List className="flex border-b border-border mb-4">
        <Tabs.Trigger
          value="general"
          className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
        >
          General
        </Tabs.Trigger>
        <Tabs.Trigger
          value="trading"
          className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
        >
          Trading Conditions
        </Tabs.Trigger>
        <Tabs.Trigger
          value="restrictions"
          className="px-4 py-2 text-sm font-medium text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent"
        >
          Restrictions
        </Tabs.Trigger>
      </Tabs.List>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Tabs.Content value="general" className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Group Name</label>
            <Input {...register('name')} disabled={readOnly} />
            {errors.name && <p className="mt-1 text-sm text-danger">{errors.name.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Base Currency</label>
            <Select
              value={currency}
              onValueChange={(value) => setValue('currency', value)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD - US Dollar</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
                <SelectItem value="GBP">GBP - British Pound</SelectItem>
                <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
                <SelectItem value="AUD">AUD - Australian Dollar</SelectItem>
              </SelectContent>
            </Select>
            {errors.currency && (
              <p className="mt-1 text-sm text-danger">{errors.currency.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Region</label>
            <Select
              value={region}
              onValueChange={(value) => setValue('region', value)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Global">Global</SelectItem>
                <SelectItem value="Europe">Europe</SelectItem>
                <SelectItem value="Asia">Asia</SelectItem>
                <SelectItem value="Americas">Americas</SelectItem>
                <SelectItem value="Middle East">Middle East</SelectItem>
                <SelectItem value="Africa">Africa</SelectItem>
              </SelectContent>
            </Select>
            {errors.region && <p className="mt-1 text-sm text-danger">{errors.region.message}</p>}
          </div>
          <div className="flex items-center justify-between py-2">
            <label className="text-sm font-medium text-text">Status</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">{status ? 'Active' : 'Disabled'}</span>
              <Switch checked={status} onCheckedChange={setStatus} disabled={readOnly} />
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="trading" className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Spread Markup (points)</label>
            <Input
              type="number"
              step="0.1"
              {...register('spreadMarkup', { valueAsNumber: true })}
              disabled={readOnly}
            />
            {errors.spreadMarkup && (
              <p className="mt-1 text-sm text-danger">{errors.spreadMarkup.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Commission (%)</label>
            <Input
              type="number"
              step="0.01"
              {...register('commission', { valueAsNumber: true })}
              disabled={readOnly}
            />
            {errors.commission && (
              <p className="mt-1 text-sm text-danger">{errors.commission.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Swap Profile</label>
            <Select
              value={swapProfile}
              onValueChange={(value) => setValue('swapProfile', value)}
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Standard Swap">Standard Swap</SelectItem>
                <SelectItem value="VIP Swap">VIP Swap</SelectItem>
                <SelectItem value="No Swap">No Swap</SelectItem>
                <SelectItem value="Islamic Swap">Islamic Swap</SelectItem>
              </SelectContent>
            </Select>
            {errors.swapProfile && (
              <p className="mt-1 text-sm text-danger">{errors.swapProfile.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Min Leverage</label>
              <Input
                type="number"
                {...register('minLeverage', { valueAsNumber: true })}
                disabled={readOnly}
              />
              {errors.minLeverage && (
                <p className="mt-1 text-sm text-danger">{errors.minLeverage.message}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-text mb-2 block">Max Leverage</label>
              <Input
                type="number"
                {...register('maxLeverage', { valueAsNumber: true })}
                disabled={readOnly}
              />
              {errors.maxLeverage && (
                <p className="mt-1 text-sm text-danger">{errors.maxLeverage.message}</p>
              )}
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="restrictions" className="space-y-4">
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Max Open Positions</label>
            <Input
              type="number"
              {...register('maxOpenPositions', { valueAsNumber: true })}
              disabled={readOnly}
            />
            {errors.maxOpenPositions && (
              <p className="mt-1 text-sm text-danger">{errors.maxOpenPositions.message}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-text mb-2 block">Max Exposure</label>
            <Input
              type="number"
              {...register('maxExposure', { valueAsNumber: true })}
              disabled={readOnly}
            />
            {errors.maxExposure && (
              <p className="mt-1 text-sm text-danger">{errors.maxExposure.message}</p>
            )}
          </div>
          <div className="flex items-center justify-between py-2">
            <label className="text-sm font-medium text-text">Trading Allowed</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">
                {tradingAllowed ? 'Yes' : 'No'}
              </span>
              <Switch checked={tradingAllowed} onCheckedChange={setTradingAllowed} disabled={readOnly} />
            </div>
          </div>
        </Tabs.Content>

        {!readOnly && (
          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => closeModal(modalKey)}
            >
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </div>
        )}
      </form>
    </Tabs.Root>
  )
}

