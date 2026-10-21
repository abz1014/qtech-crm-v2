import { Children, Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Breadcrumb, type Crumb } from '@/ui/Breadcrumb'

/*
 * DetailHeader (round-2 spec 5.3, with the coordinator's decision): the head of a detail page (RFQ, Order, Company).
 *
 *   Breadcrumb (md+): Section › CODE, the default muted style
 *   Row: [h1 = NAME (optionally a link: the company on RFQ and Order) + CODE as `num text-lg font-medium text-fg-muted`,
 *         the code hidden below md (the phone bar shows it)]   [right: the "More" menu only]
 *   Chip row (mt-2): at most 2 StatusBadges, never inside the h1
 *   Meta line: text-sm text-fg-2, "·" between items, at most 5 items
 *   children: the page renders its `NextStepBox` here (and, optionally, one facts strip)
 *
 * There is NO primary button in the header: every detail page shows its one green action in the shared NextStepBox directly
 * under the title, and phones put the same action in the StickyActionBar. The More menu here is desktop only (`max-md:hidden`);
 * on a phone the page passes `<MoreMenu touch />` to useMobileBar's actions instead.
 * In development and tests it throws with more than 2 chips or more than 5 meta items.
 */
export interface DetailHeaderProps {
  /** The record's name: the h1. */
  name: ReactNode
  /** Makes the name a link (the company, on the RFQ and Order pages). */
  nameHref?: string
  /** The record's code (RFQ-0177): beside the name in the h1, desktop only. */
  code?: string
  /** md and up. Default style; identifiers `mono`. */
  breadcrumb?: readonly Crumb[]
  /** A `<MoreMenu />` (desktop). The only thing on the right of the title row. */
  more?: ReactNode
  /** At most 2 StatusBadges. */
  chips?: ReactNode
  /** At most 5 short items, joined with "·". Falsy items are skipped. */
  meta?: readonly ReactNode[]
  /** Under the header lines: the page's NextStepBox, then at most one facts strip. */
  children?: ReactNode
  className?: string
}

function count(node: ReactNode): number {
  return Children.toArray(node).reduce<number>(
    (n, c) =>
      n +
      (typeof c === 'object' && c !== null && 'type' in c && c.type === Fragment
        ? count((c.props as { children?: ReactNode }).children)
        : 1),
    0,
  )
}

export function DetailHeader({ name, nameHref, code, breadcrumb, more, chips, meta, children, className }: DetailHeaderProps) {
  const items = (meta ?? []).filter(m => m !== null && m !== undefined && m !== false && m !== '')
  if (import.meta.env.DEV) {
    if (count(chips) > 2) throw new Error(`DetailHeader: at most 2 status chips (got ${count(chips)}).`)
    if (items.length > 5) throw new Error(`DetailHeader: at most 5 meta items (got ${items.length}).`)
  }
  return (
    <header className={cn('grid grid-cols-[minmax(0,1fr)]', className)}>
      {breadcrumb?.length ? <Breadcrumb items={breadcrumb} className="mb-2 max-md:hidden" /> : null}
      <div className="flex items-start justify-between gap-4">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-pretty max-md:text-xl">
          {nameHref ? (
            <Link to={nameHref} className="rounded underline-offset-4 hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {code ? (
            <>
              {' '}
              <span className="num ml-1 text-lg font-medium text-fg-muted max-md:hidden">{code}</span>
            </>
          ) : null}
        </h1>
        {more ? <div className="shrink-0 max-md:hidden">{more}</div> : null}
      </div>
      {chips ? <div className="mt-2 flex flex-wrap items-center gap-2">{chips}</div> : null}
      {items.length ? (
        // On a phone the meta wraps anyway, so it is a plain list, one item per line, without the "·" (a wrapped "· Owner X ·" looks broken).
        <p className="mt-2 text-sm text-fg-2 max-md:grid max-md:justify-items-start max-md:gap-1">
          {items.map((m, i) => (
            <Fragment key={i}>
              {i ? (
                <span aria-hidden="true" className="mx-2 text-fg-muted max-md:hidden">
                  ·
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">{m}</span>
            </Fragment>
          ))}
        </p>
      ) : null}
      {children}
    </header>
  )
}
