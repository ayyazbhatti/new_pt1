import { ReactNode } from 'react'
import { Badge } from '@/shared/ui/badge'

interface AuthCardProps {
  children: ReactNode
  className?: string
}

export function AuthCard({ children, className }: AuthCardProps) {
  return (
    <div
      className={`relative max-w-md w-full bg-[#161a22] border border-[#2a3345] rounded-lg overflow-hidden shadow-xl ${className || ''}`}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#4f8cff] via-[#4f8cff]/80 to-[#4f8cff]/60" />
      
      {/* Subtle background glows */}
      <div className="absolute top-0 left-0 w-64 h-64 bg-[#4f8cff]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-64 h-64 bg-[#4f8cff]/5 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
      
      <div className="relative p-8">
        <div className="flex justify-end mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="neutral" className="text-xs">V1</Badge>
            <Badge variant="neutral" className="text-xs">Demo Auth</Badge>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

