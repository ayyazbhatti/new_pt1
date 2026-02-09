interface EmptyStateProps {
  message?: string
}

export function EmptyState({ message = 'No data available' }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-text-dim">{message}</div>
    </div>
  )
}

