import { useState, useEffect } from 'react'
import { Input } from '../input'
import { cn } from '@/shared/utils'

interface EditableTableCellProps {
  value: string | number
  onSave: (value: string | number) => void
  type?: 'text' | 'number'
  className?: string
  disabled?: boolean
}

export function EditableTableCell({
  value,
  onSave,
  type = 'text',
  className,
  disabled = false,
}: EditableTableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value.toString())

  useEffect(() => {
    setEditValue(value.toString())
  }, [value])

  const handleSave = () => {
    const finalValue = type === 'number' ? Number(editValue) : editValue
    onSave(finalValue)
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditValue(value.toString())
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (disabled) {
    return <span className={cn('px-2 py-1', className)}>{value}</span>
  }

  if (isEditing) {
    return (
      <Input
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn('h-8 px-2 py-1 text-sm', className)}
        autoFocus
      />
    )
  }

  return (
    <span
      className={cn('px-2 py-1 cursor-pointer hover:bg-surface-2 rounded', className)}
      onClick={() => setIsEditing(true)}
      title="Click to edit"
    >
      {value}
    </span>
  )
}

