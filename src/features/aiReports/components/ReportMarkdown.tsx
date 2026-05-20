import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/shared/utils'

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-semibold text-text mt-6 mb-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-text mt-5 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-text mt-4 mb-2 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="text-sm text-text leading-relaxed mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 text-sm text-text mb-3 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 text-sm text-text mb-3 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="text-text">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  em: ({ children }) => <em className="text-text-muted">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/50 pl-3 my-3 text-text-muted text-sm italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-4" />,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-accent underline underline-offset-2 hover:text-accent/80"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-4 table-scroll rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border bg-surface-2 px-2 py-1.5 text-left font-medium text-text">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-text">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <pre className="my-3 table-scroll rounded-lg bg-surface-2 border border-border px-3 py-2">
          <code className={cn('font-mono text-xs text-text', className)} {...props}>
            {children}
          </code>
        </pre>
      )
    }
    return (
      <code className="bg-surface-2 rounded px-1 py-0.5 font-mono text-xs text-text" {...props}>
        {children}
      </code>
    )
  },
}

export interface ReportMarkdownProps {
  content: string
  className?: string
}

export function ReportMarkdown({ content, className }: ReportMarkdownProps) {
  if (!content.trim()) {
    return (
      <p className="text-sm text-text-muted italic">Generating report…</p>
    )
  }

  return (
    <div className={cn('report-markdown prose-invert max-w-none', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
