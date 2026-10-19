import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * The panel on the RFQ page (g2-rfq-detail .panel): a header with the title, a muted line under it and the actions on the
 * right; or, for a rail card, the title with a small pill at the right. One header look for every panel on the page.
 */
export function DetailPanel({
  title,
  meta,
  pill,
  actions,
  children,
  className,
  dataSlot,
}: {
  title: ReactNode
  /** The muted line under the title ("4 items · 6 suppliers asked"). */
  meta?: ReactNode
  /** A small count at the right of the title ("6 asked · 5 replied"). */
  pill?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  dataSlot?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} data-slot={dataSlot} className={cn('min-w-0 rounded border bg-surface', className)}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-5 py-4">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {meta ? <p className="mt-[2px] text-sm text-fg-muted">{meta}</p> : null}
        </div>
        {pill ? <span className="text-sm text-fg-muted">{pill}</span> : null}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}
