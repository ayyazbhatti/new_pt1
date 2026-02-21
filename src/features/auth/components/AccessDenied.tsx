import { ShieldX } from 'lucide-react'
import { Button } from '@/shared/ui'
import { useNavigate } from 'react-router-dom'

export function AccessDenied() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center min-h-[320px] px-4 text-center">
      <ShieldX className="h-16 w-16 text-danger/80 mb-4" />
      <h2 className="text-xl font-semibold text-text mb-2">Access denied</h2>
      <p className="text-text-muted text-sm max-w-sm mb-6">
        You don&apos;t have permission to view this page.
      </p>
      <Button variant="secondary" onClick={() => navigate(-1)}>
        Go back
      </Button>
    </div>
  )
}
