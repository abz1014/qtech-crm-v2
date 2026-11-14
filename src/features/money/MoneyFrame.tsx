import { memo, useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Icon } from '@/ui/Icon'
import { MONEY_TABS, MORE_MONEY_PAGES, moneyTabLabel, type MoneyTab } from '@/features/money/moneyTabs'
import { isMonthKey } from '@/features/money/monthKey'
import { PageHeader } from '@/ui/PageHeader'
import { MoneyPagesSwitcher } from '@/features/money/MoneyPagesSheet'

/*
 * The frame every Money view sits in: the title (the tab's own name, so the page always says where you are), the page's one
 * green action and the Money tabs (owner decision 2026-10-19: two levels, never a third strip; round 3: Reports is the fifth
 * tab, so every report page lights a tab). Desktop: one row of tabs, and for an admin the "More money pages" row under it.
 * Phone (below 768): an admin gets ONE switcher row, "Invoices v ... All Money pages", that opens a sheet with the five tabs and
 * the other six pages, the current one ticked (MoneyPagesSheet; clarity lane L2). Sales keep their three tabs in one row. The
 * phone bar says "Money" and the switcher names the page. No date line: the month views carry their own month. No tab carries a
 * number (redesign phase 0, plan section (c)): the one "needs you" count is Today's, and a late payment is a row on Today
 * (features/today/needsYou.ts).
 * Forest (50-money-hub.html#money-strip): the desktop tabs are one underlined strip on a hairline, the lit tab green with a 3 px
 * bar under it and scrolled into view when the window is narrow (R-023); Payments carries a small "New" word (gate 2).
 */
export function MoneyFrame({
  active,
  actions,
  title,
  barTitle,
  lede,
  morePages = true,
  children,
}: {
  active: string | null
  actions?: ReactNode
  /** The h1; the active tab's name when absent. */
  title?: string
  /** The phone bar's title. Default "Money": on a phone the switcher row names the page, not the bar. */
  barTitle?: string
  /** The line under the h1 when it is not "All amounts in PKR". A view with no line made the tabs sit higher than on its sister tabs. */
  lede?: ReactNode
  /** The "More money pages" row (admin only). Money home turns it off: its Accounts section already lists them. */
  morePages?: boolean
  children: ReactNode
}) {
  const session = useSession()
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const month = isMonthKey(params.get('month')) ? params.get('month') : null // a month view's month follows to Reports
  const role = session.status === 'signed-in' ? session.user.role : ''
  const isAdmin = role === 'admin'
  const tabs = MONEY_TABS.filter(t => isAdmin || !t.adminOnly)
  const heading = title ?? moneyTabLabel(active)
  const toOf = (t: MoneyTab) => (t.key === 'reports' && month ? `${t.to}?month=${month}` : t.to)
  // Admin on a phone: one switcher row and a sheet. Sales (three tabs) keep the one row of tabs.
  const phone = useMediaQuery('(max-width: 767px)')
  const isHere = (to: string) => pathname === to || pathname.startsWith(`${to}/`)
  const current = MORE_MONEY_PAGES.find(p => isHere(p.to))?.label ?? heading
  return (
    // One column no wider than the screen (minmax(0, 1fr)): a wide child (a register's table) scrolls inside its own card
    // instead of stretching the column, and every card with it, past the right edge of a phone.
    <div className="mx-auto grid w-full min-w-0 max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-4 md:px-8 md:pt-6">
      {/* The phone bar's title. Rendered before the page, so a sub-page's own bar (MoneySubHeader) wins. */}
      <FrameBar title={barTitle ?? 'Money'} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:gap-4">
        {/* The list-page head (spec 5.2): the view's name and the page's one green action (`actions`). */}
        <PageHeader
          title={heading}
          lede={lede ?? <span className="max-md:hidden">All amounts in PKR</span>}
          primary={actions}
        />
        {phone && isAdmin ? (
          <MoneyPagesSwitcher current={current} tabs={tabs} activeKey={active} more={MORE_MONEY_PAGES} toOf={toOf} isHere={isHere} />
        ) : phone ? (
          <nav aria-label="Money views" className="grid min-w-0 gap-1 rounded bg-selected p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} data-testid="money-tabs-phone">
            {tabs.map(t => (
              <TabLink key={t.key} tab={t} to={toOf(t)} on={t.key === active} phone />
            ))}
          </nav>
        ) : (
          <DesktopTabs tabs={tabs} active={active} toOf={toOf} />
        )}
        {isAdmin && morePages && !phone ? (
          <div role="group" aria-label="More money pages" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm text-fg-muted">More money pages</span>
            {MORE_MONEY_PAGES.map(p => {
              // The page you are on is marked for assistive technology and drawn bold, dark and without the underline.
              const here = isHere(p.to)
              return (
                <Link
                  key={p.to}
                  to={p.to}
                  aria-current={here ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-control items-center text-sm',
                    here ? 'font-semibold text-fg no-underline' : 'font-medium text-fg-2 underline decoration-fg/40 underline-offset-4 hover:text-fg hover:decoration-fg',
                  )}
                >
                  {p.label}
                </Link>
              )
            })}
          </div>
        ) : null}
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

/** The desktop strip: it scrolls sideways only when the tabs are wider than the page, and the lit tab is brought into view. */
function DesktopTabs({ tabs, active, toOf }: { tabs: readonly MoneyTab[]; active: string | null; toOf: (t: MoneyTab) => string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <nav ref={ref} aria-label="Money views" className="hairline-under flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden" data-testid="money-tabs">
      {tabs.map(t => (
        <TabLink key={t.key} tab={t} to={toOf(t)} on={t.key === active} />
      ))}
    </nav>
  )
}

/** One Money tab. A plain Link: the lit tab follows `active`, not the address (a page that is not a tab passes null). */
function TabLink({ tab, to, on, phone }: { tab: MoneyTab; to: string; on: boolean; phone?: boolean }) {
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'inline-flex items-center transition-colors duration-fast ease-out',
        phone
          ? 'min-h-touch min-w-0 justify-center gap-1 rounded border px-1 text-center text-sm font-medium leading-tight'
          : 'min-h-control shrink-0 gap-2 border-b-ring px-4 text-sm font-card',
        phone ? (on ? 'border-chrome bg-chrome text-chrome-fg' : 'border-transparent text-fg-muted hover:text-fg') : on ? 'border-primary font-heavy text-primary' : 'border-transparent text-fg-2 hover:text-fg',
      )}
    >
      {/* One label on every screen: the full name. */}
      <span className="whitespace-nowrap">{tab.label}</span>
      {tab.isNew && !phone ? (
        <span aria-hidden="true" className="rounded-pill bg-brand-100 px-2 text-xs font-heavy text-primary">
          New
        </span>
      ) : null}
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
          <h2 className={cn('text-xl font-heavy tracking-snug', !meta && 'max-md:sr-only')}>{title}</h2>
          {meta}
        </div>
        <span className="flex-1 max-md:hidden" />
        {actions}
      </div>
    </div>
  )
}
