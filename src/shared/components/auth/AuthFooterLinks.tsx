import { Link } from 'react-router-dom'

interface AuthFooterLinksProps {
  primaryText: string
  primaryLink: string
  primaryLinkText: string
}

export function AuthFooterLinks({ primaryText, primaryLink, primaryLinkText }: AuthFooterLinksProps) {
  return (
    <div className="mt-6 text-center text-sm">
      <span className="text-[#aab2c5]">{primaryText} </span>
      <Link
        to={primaryLink}
        className="text-[#4f8cff] hover:text-[#4f8cff]/80 font-medium transition-colors"
      >
        {primaryLinkText}
      </Link>
    </div>
  )
}

