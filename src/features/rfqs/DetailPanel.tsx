import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * The panel of the Quotation step (clarity L4: no box, a hairline under its header; the rows inside are hairline rows): a header with the title, a muted line under it and the actions on the
 * right; or, for a rail card, the title with a small pill at the right. One header look for every panel on the page.
 */
export function DetailPanel({
  title,
  tip,
  meta,
  pill,
  actions,
  children,
  className,
  dataSlot,
}: {
  title: ReactNode
  /** An InfoTip beside the title. Kept outside the h2, so the heading's name is the title alone. */
  tip?: ReactNode
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
    <section aria-labelledby={id} data-slot={dataSlot} className={cn('min-w-0', className)}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b py-2">
        <div className="min-w-0 flex-1 basis-[12rem]">
          <div className="flex items-center gap-1">
            <h2 id={id} className="type-section">
              {title}
            </h2>
            {tip}
          </div>
          {meta ? <p className="mt-[2px] text-base text-fg-muted">{meta}</p> : null}
        </div>
        {pill ? <span className="text-sm text-fg-muted">{pill}</span> : null}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}
