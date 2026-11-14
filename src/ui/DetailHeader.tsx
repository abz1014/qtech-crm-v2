import { Children, Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Breadcrumb, type Crumb } from '@/ui/Breadcrumb'
import { buttonStyles } from '@/ui/buttonStyles'
import { Icon } from '@/ui/Icon'

/*
 * DetailHeader (round-2 spec 5.3, with the coordinator's decision): the head of a detail page (RFQ, Order, Company).
 *
 *   Breadcrumb (md+): Section › CODE, the default muted style; or, with `back`, the Forest way back (30-job-page, 71-company-page):
 *   one outline button "← Deliver" left of the title, the title's lines (h1, `sub`, chips, meta) beside it. It is still the
 *   page's Breadcrumb navigation, so a screen reader finds the way back where it was.
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
  /** md and up: the way back as an outline button left of the title (Forest). A phone has the bar's back arrow. */
  back?: { label: string; to: string }
  /** A line under the h1, in the title's column (the Job page's "Owner Omar · Lahore"). */
  sub?: ReactNode
  /** A `<MoreMenu />` (desktop). The only thing on the right of the title row. */
  more?: ReactNode
  /** At most 2 StatusBadges. */
  chips?: ReactNode
  /** At most 5 short items, joined with "·". Falsy items are skipped. */
  meta?: readonly ReactNode[]
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

export function DetailHeader({ name, nameHref, code, breadcrumb, back, sub, more, chips, meta, children, className, phoneSrOnly = false }: DetailHeaderProps) {
  const items = (meta ?? []).filter(m => m !== null && m !== undefined && m !== false && m !== '')
  if (import.meta.env.DEV) {
    if (count(chips) > 2) throw new Error(`DetailHeader: at most 2 status chips (got ${count(chips)}).`)
    if (items.length > 5) throw new Error(`DetailHeader: at most 5 meta items (got ${items.length}).`)
  }
  return (
    // With `back`: from 768 px a two-column grid, the button in the first column beside every title line; children span both.
    <header className={cn('grid grid-cols-[minmax(0,1fr)]', back && 'md:grid-cols-[auto_minmax(0,1fr)] md:gap-x-4', className)}>
      {back ? (
        <nav aria-label="Breadcrumb" className="row-span-4 self-start max-md:hidden">
          <Link to={back.to} className={buttonStyles({ variant: 'secondary' })}>
            <Icon icon={ArrowLeft} />
            {back.label}
          </Link>
        </nav>
      ) : breadcrumb?.length ? (
        <Breadcrumb items={breadcrumb} className="mb-2 max-md:hidden" />
      ) : null}
      <div className={cn('flex items-start justify-between gap-4', back && 'md:min-h-control md:items-center', phoneSrOnly && 'max-md:sr-only max-md:focus-within:not-sr-only')}>
        <h1 className="min-w-0 text-2xl font-heavy tracking-tight text-pretty max-md:text-xl">
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
      {back && children ? <div className="grid grid-cols-[minmax(0,1fr)] md:col-span-2">{children}</div> : children}
    </header>
  )
}
