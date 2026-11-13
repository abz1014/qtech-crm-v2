import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A shell-level page drawn as one card (Forest 84-auth-errors, .au-page): heavy page
 * title, one muted line and optional content, inside the shell so the navigation
 * stays usable. Used by Page not found.
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
    <div className={cn('mx-auto grid max-w-list content-start px-gutter pb-12 pt-6', className)}>
      <section className="grid min-w-0 justify-items-start gap-3 rounded-card border border-line bg-surface p-card shadow-e1">
        <header className="grid min-w-0 gap-1">
          <h1 className="text-2xl font-heavy tracking-tight [overflow-wrap:anywhere]">{title}</h1>
          {lede ? <p className="max-w-prose text-sm text-fg-muted text-pretty">{lede}</p> : null}
        </header>
        {children}
      </section>
    </div>
  )
}
