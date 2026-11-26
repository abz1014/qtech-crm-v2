import { Children, Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Breadcrumb, type Crumb } from '@/ui/Breadcrumb'
import { BackLink } from '@/ui/BackLink'

/*
 * DetailHeader (round-2 spec 5.3, with the coordinator's decision): the head of a detail page (RFQ, Order, Company).
 *
 *   Breadcrumb (md+): Section › CODE, the default muted style; or, with `back`, the one way back every page uses (BackLink,
 *   "< Deliver") above the title (screen review 27: this was an outline button beside the title, Money had a text link). It is
 *   still the page's Breadcrumb navigation, so a screen reader finds the way back where it was.
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
  /** md and up. Default style; identifiers `mono`. Not drawn when `back` is given. */
  breadcrumb?: readonly Crumb[]
  /** md and up: the way back (BackLink) above the title. A phone has the bar's back arrow. */
  back?: { label: string; to: string }
  /** A line under the h1, in the title's column (the Job page's "Owner Omar · Lahore"). */
  sub?: ReactNode
  /** A `<MoreMenu />` (desktop). The only thing on the right of the title row. */
  more?: ReactNode
  /** At most 2 StatusBadges. */
  chips?: ReactNode
  /** At most 5 short items, joined with "·". Falsy items are skipped. */
  meta?: readonly ReactNode[]
  /** One more line under the meta (a supplier's record line, "Last changed"): it lines up with the h1 (audit 2). */
  line?: ReactNode
  /** Under the header lines: the page's NextStepBox, then at most one facts strip. */
  children?: ReactNode
  className?: string
  /** The name is read by a screen reader but not drawn below md: the phone bar carries it (the Job page). It is drawn while the
   *  name link has keyboard focus, so a Tab stop is never invisible (WCAG 2.4.7; a11y Tab sweep at 200% zoom). */
  phoneSrOnly?: boolean
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

export function DetailHeader({ name, nameHref, code, breadcrumb, back, sub, more, chips, meta, line, children, className, phoneSrOnly = false }: DetailHeaderProps) {
  const items = (meta ?? []).filter(m => m !== null && m !== undefined && m !== false && m !== '')
  if (import.meta.env.DEV) {
    if (count(chips) > 2) throw new Error(`DetailHeader: at most 2 status chips (got ${count(chips)}).`)
    if (items.length > 5) throw new Error(`DetailHeader: at most 5 meta items (got ${items.length}).`)
  }
  return (
    <header className={cn('grid grid-cols-[minmax(0,1fr)]', className)}>
      {back ? (
        <nav aria-label="Breadcrumb" className="mb-2 grid max-md:hidden">
          <BackLink to={back.to} label={back.label} />
        </nav>
      ) : breadcrumb?.length ? (
        <Breadcrumb items={breadcrumb} className="mb-2 max-md:hidden" />
      ) : null}
      <div className={cn('flex items-start justify-between gap-4', phoneSrOnly && 'max-md:sr-only max-md:focus-within:not-sr-only')}>
        {/* A very long name stops at three lines (a 300-character company ran 8 lines at 320 px: screen review 26); the whole name is
            the hover title and what a screen reader reads. A name that is a link is not clamped: the clip would cut its focus ring. */}
        <h1
          className={cn('min-w-0 text-2xl font-heavy tracking-tight text-pretty [overflow-wrap:anywhere] max-md:text-xl', !nameHref && 'line-clamp-3')}
          title={!nameHref && typeof name === 'string' ? name : undefined}
        >
          {nameHref ? (
            <Link to={nameHref} className="rounded-control underline-offset-4 hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {code ? (
            <>
              {' '}
              <span className="num ml-1 whitespace-nowrap text-lg font-medium text-fg-muted max-md:hidden">{code}</span>
            </>
          ) : null}
        </h1>
        {more ? <div className="shrink-0 max-md:hidden">{more}</div> : null}
      </div>
      {sub}
      {chips ? <div className="mt-2 flex flex-wrap items-center gap-2">{chips}</div> : null}
      {items.length ? (
        // Each item carries the dot before it, as one unit, and the row is pulled 20 px left into a clipped edge: the dot of
        // an item that starts a wrapped line falls in that edge, so on a phone no line ends (or starts) with a dangling dot.
        <p className="mt-2 overflow-x-clip text-sm text-fg-2">
          <span className="-ml-5 flex flex-wrap items-center">
            {items.map((m, i) => (
              <span key={i} className={cn('inline-flex min-w-0 items-center', i === 0 && 'pl-5')}>
                {i ? (
                  <span aria-hidden="true" className="w-5 shrink-0 text-center text-fg-muted">
                    ·
                  </span>
                ) : null}
                <span className="inline-flex min-w-0 items-center gap-1">{m}</span>
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {line ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">{line}</div> : null}
      {children}
    </header>
  )
}
