import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Page title block for shell-level pages: title (28/34, semibold, tight), one
 * muted line, and optional content. Screens replace these pages and use the
 * PageHeader composite when it lands; this is the minimum the shell needs.
 */
export function PageFrame({
  title,
  lede,
  children,
  className,
}: {
  title: string
  lede?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mx-auto grid max-w-list content-start gap-4 px-4 pb-12 pt-6 md:px-8', className)}>
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lede ? <p className="max-w-prose text-sm text-fg-muted">{lede}</p> : null}
      </header>
      {children}
    </div>
  )
}
