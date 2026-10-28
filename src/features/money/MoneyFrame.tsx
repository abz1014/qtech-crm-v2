import { memo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Icon } from '@/ui/Icon'
import { MONEY_TABS, moneyTabLabel, type MoneyTab } from '@/features/money/moneyTabs'
import { isMonthKey } from '@/features/money/monthKey'
import { PageHeader } from '@/ui/PageHeader'

/*
 * The frame every Money view sits in: the title (the tab's own name, so the page always says where you are), the page's one
 * green action and the Money tabs (owner decision 2026-10-19: two levels, never a third strip; round 3: Reports is the fifth
 * tab, so every report page lights a tab). Desktop: one row of tabs. Phone (below 768): ONE row of short labels
 * ("Owed · Invoices · Expenses · Lock a month"), never a grid and never a sideways strip. Five do not fit at 320 px, so admin's
 * Reports sits beside the page action on a phone (lit when open); the phone bar names the view. No date line: the month
 * views carry their own month. No tab carries a number (redesign phase 0, plan section (c)): the one "needs you" count is
 * Today's, and a late payment is a row on Today (features/today/needsYou.ts).
 */
export function MoneyFrame({
  active,
  actions,
  title,
  children,
}: {
  active: string | null
  actions?: ReactNode
  /** The h1; the active tab's name when absent. */
  title?: string
  children: ReactNode
}) {
  const session = useSession()
  const [params] = useSearchParams()
  const month = isMonthKey(params.get('month')) ? params.get('month') : null // a month view's month follows to Reports
  const role = session.status === 'signed-in' ? session.user.role : ''
  const isAdmin = role === 'admin'
  const tabs = MONEY_TABS.filter(t => isAdmin || !t.adminOnly)
  const heading = title ?? moneyTabLabel(active)
  const toOf = (t: MoneyTab) => (t.key === 'reports' && month ? `${t.to}?month=${month}` : t.to)
  // Every tab stays in the strip on a phone, so the lit one is always there. Admin's five go three over two (6 columns, spans 2 and 3).
  const phone = useMediaQuery('(max-width: 767px)')
  const twoRows = tabs.length > 4
  return (
    // One column no wider than the screen (minmax(0, 1fr)): a wide child (a register's table) scrolls inside its own card
    // instead of stretching the column, and every card with it, past the right edge of a phone.
    <div className="mx-auto grid w-full min-w-0 max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-4 md:px-8 md:pt-6">
      {/* The phone bar's title. Rendered before the page, so a sub-page's own bar (MoneySubHeader) wins. */}
      <FrameBar title={heading} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:gap-4">
        {/* The list-page head (spec 5.2): the view's name and the page's one green action (`actions`). */}
        <PageHeader
          title={heading}
          lede={active === 'reports' ? undefined : <span className="max-md:hidden">All amounts in PKR</span>}
          primary={actions}
        />
        {phone ? (
          <nav aria-label="Money views" className="grid min-w-0 gap-1 rounded bg-selected p-1" style={{ gridTemplateColumns: twoRows ? 'repeat(6, minmax(0, 1fr))' : `repeat(${tabs.length}, minmax(0, 1fr))` }} data-testid="money-tabs-phone">
            {tabs.map((t, at) => (
              <TabLink key={t.key} tab={t} to={toOf(t)} on={t.key === active} phone span={twoRows ? (at < 3 ? 2 : 3) : undefined} />
            ))}
          </nav>
        ) : (
          <nav aria-label="Money views" className="inline-flex max-w-full gap-[2px] justify-self-start rounded bg-selected p-[2px]" data-testid="money-tabs">
            {tabs.map(t => (
              <TabLink key={t.key} tab={t} to={toOf(t)} on={t.key === active} />
            ))}
          </nav>
        )}
      </div>
      {children}
    </div>
  )
}

// Memo: a re-render of the frame must not replace the bar a sub-page set (Lock a month's hideTabs) with the plain title. It re-runs
// only when the title changes.
const FrameBar = memo(function FrameBar({ title }: { title: string }) {
  useMobileBar({ title })
  return null
})

/** One Money tab. A plain Link: the lit tab follows `active` (Lock a month stays lit on the pages reached from it), not the address. */
function TabLink({ tab, to, on, phone, span }: { tab: MoneyTab; to: string; on: boolean; phone?: boolean; span?: number }) {
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      style={span ? { gridColumn: `span ${span}` } : undefined}
      className={cn(
        'inline-flex items-center rounded border font-medium transition-colors duration-fast ease-out',
        phone ? 'min-h-touch min-w-0 justify-center gap-1 px-1 text-center text-sm leading-tight' : 'min-h-control gap-2 px-4 text-sm',
        on ? 'border-chrome bg-chrome text-chrome-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {/* One label on every screen: the full name. */}
      <span className="whitespace-nowrap">{tab.label}</span>
    </Link>
  )
}

/**
 * The heading of a view reached from a Money tab rather than being one (Bank check, Margins, Mistakes to fix): a
 * back link to where it was opened from, the title and its actions. It replaces the old third strip of tabs.
 * On a phone the back link is the phone bar's own back arrow (one bar, UX audit 2026-10-19), so it is not drawn twice, and
 * the title is the phone bar's (not repeated as a heading).
 */
export function MoneySubHeader({
  back,
  title,
  meta,
  actions,
}: {
  back: { to: string; label: string }
  title: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  // Back goes where the person came from (Today's "Margin not final" item, Reports, the checklist), else to `back.to`.
  useMobileBar({ title, back: 'history', fallback: back.to })
  return (
    <div className="grid gap-2">
      <Link to={back.to} className="inline-flex items-center gap-1 justify-self-start text-sm font-medium text-fg-2 hover:text-fg hover:underline max-md:hidden">
        <Icon icon={ChevronLeft} size="sm" />
        <span className="sr-only">Back to </span>
        {back.label}
      </Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The title and what explains it (the (i), a tag) stay together: a lone (i) under the phone bar pointed at nothing. So a view with `meta` draws its title on a phone too. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className={cn('text-xl font-semibold tracking-snug', !meta && 'max-md:sr-only')}>{title}</h2>
          {meta}
        </div>
        <span className="flex-1 max-md:hidden" />
        {actions}
      </div>
    </div>
  )
}
