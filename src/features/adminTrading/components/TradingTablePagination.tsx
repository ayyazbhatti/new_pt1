import { Button } from '@/shared/ui/button'

const PAGE_SIZE = 25
export { PAGE_SIZE }

export function TradingTablePagination({
  page,
  pageSize,
  total,
  loading,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number | null
  loading?: boolean
  onPageChange: (p: number) => void
}) {
  if (loading || total === null || total === 0) return null
  if (total <= pageSize) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-text-muted">
        Showing <span className="font-medium text-text">{from}</span>–
        <span className="font-medium text-text">{to}</span> of{' '}
        <span className="font-medium text-text">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="min-w-[7rem] text-center text-sm text-text-muted">
          Page {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
