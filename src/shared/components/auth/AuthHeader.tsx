interface AuthHeaderProps {
  title: string
  subtitle: string
}

export function AuthHeader({ title, subtitle }: AuthHeaderProps) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-[#e6e8ee] mb-2">{title}</h1>
      <p className="text-sm text-[#aab2c5]">{subtitle}</p>
    </div>
  )
}

