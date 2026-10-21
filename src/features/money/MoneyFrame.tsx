import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChartColumn, ChevronLeft } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Icon } from '@/ui/Icon'
import { computeReconciliationExceptions } from '@/lib/reconciliation'
import { useReconciliationInput } from '@/features/money/hooks'
import { useGstRegister } from '@/features/money/invoices/hooks'
import { needsAttention } from '@/features/money/invoices/model'
import { MONEY_TABS, moneyTabLabel, type MoneyTab } from '@/features/money/moneyTabs'
import { openFindings } from '@/features/money/exceptions/checked'
import { useClosedMonths, useMonthEndStatus } from '@/features/money/monthEnd/hooks'
import { buildChecklist, checksWithItems, defaultMonthEndMonth, isMonthKey } from '@/features/money/monthEnd/model'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'
import { NeedsCount } from '@/ui/Tag'
import { PageHeader } from '@/ui/PageHeader'

/*
 * The frame every Money view sits in: the title (the tab's own name, so the page always says where you are), the page's one
 * green action and the Money tabs (owner decision 2026-10-19: two levels, never a third strip; round 3: Reports is the fifth
 * tab, so every report page lights a tab). Desktop: one row of tabs. Phone (below 768): ONE row of short labels
 * ("Owed · Invoices · Expenses · Month end"), never a grid and never a sideways strip. Five do not fit at 320 px, so admin's
 * Reports sits beside the page action on a phone (lit when open); the phone bar names the view. No date line: the month
 * views carry their own month. A count beside a tab means "needs you", nothing else:
 *   Who owes us     exactly Today's payment items for this person: overdue, not reminded for 7 working days, routed by owner
 *                   (sales see their own orders; admin the rest), snoozes respected. It reads Today's list, which the top bar
 *                   already loads.
 *   Invoices & GST  invoices that need attention (tax not deposited after the month, a step out of order), admin and sales
 *   Month end       admin only, while the month that just ended is open: the checks with items, plus Things to check when the
 *                   reconciliation finds something; the same number the checklist page says
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
  const money = role === 'admin' || role === 'sales'
  const tabs = MONEY_TABS.filter(t => isAdmin || !t.adminOnly)
  const today = businessToday()
  const todayView = useTodayView({ id: session.status === 'signed-in' ? session.user.id : '', role: role as Role }, useBusinessToday())
  const register = useGstRegister(money)
  const monthEnd = defaultMonthEndMonth(today)
  const checks = useMonthEndStatus(monthEnd, isAdmin)
  const closed = useClosedMonths(isAdmin)
  const monthOpen = closed.data ? !closed.data.some(c => c.key === monthEnd) : false
  const recon = useReconciliationInput(isAdmin && monthOpen)
  const things = useMemo(() => (recon.data ? openFindings(session.status === 'signed-in' ? session.user.id : null, computeReconciliationExceptions(recon.data)).length : 0), [recon.data, session])
  const counts: Record<string, number | undefined> = {
    receivables: todayView.view?.active.filter(i => i.rule === 'payment_overdue').length,
    'gst-register': register.data?.filter(needsAttention).length,
    'month-end': checks.data && monthOpen ? checksWithItems(buildChecklist(checks.data, monthEnd)) + (things > 0 ? 1 : 0) : undefined,
  }
  const heading = title ?? moneyTabLabel(active)
  const toOf = (t: MoneyTab) => (t.key === 'reports' && month ? `${t.to}?month=${month}` : t.to)
  // Five short labels do not fit one row at 320 px: admin's Reports sits beside the page action on a phone instead.
  const phone = useMediaQuery('(max-width: 767px)')
  const crowded = tabs.length > 4
  const phoneTabs = crowded ? tabs.filter(t => t.key !== 'reports') : tabs
  const reportsTab = phone && crowded ? tabs.find(t => t.key === 'reports') : undefined
  return (
    <div className="grid w-full min-w-0 content-start gap-4 px-4 pb-12 pt-4 md:px-8 md:pt-6">
      {/* The phone bar's title. Rendered before the page, so a sub-page's own bar (MoneySubHeader) wins. */}
      <FrameBar title={heading} />
      <div className="grid gap-3 md:gap-4">
        {/* The list-page head (spec 5.2): the view's name and the page's one green action (`actions`). */}
        <PageHeader
          title={heading}
          lede={active === 'reports' ? undefined : <span className="max-md:hidden">All amounts in PKR</span>}
          primary={actions}
          secondary={
            reportsTab ? (
              <Link
                to={toOf(reportsTab)}
                aria-current={active === 'reports' ? 'page' : undefined}
                className={cn(
                  'inline-flex h-touch items-center gap-2 rounded border px-3 text-sm font-medium',
                  active === 'reports' ? 'border-fg bg-selected text-fg' : 'border-line-strong bg-surface text-fg',
                )}
              >
                <Icon icon={ChartColumn} className="text-fg-muted" />
                Reports
              </Link>
            ) : undefined
          }
        />
        {phone ? (
          <nav aria-label="Money views" className="flex min-w-0 gap-[2px] rounded bg-selected p-[2px]" data-testid="money-tabs-phone">
            {phoneTabs.map(t => (
              <TabLink key={t.key} tab={t} to={toOf(t)} on={t.key === active} n={counts[t.key]} phone />
            ))}
          </nav>
        ) : (
          <nav aria-label="Money views" className="inline-flex max-w-full gap-[2px] justify-self-start rounded bg-selected p-[2px]" data-testid="money-tabs">
            {tabs.map(t => (
              <TabLink key={t.key} tab={t} to={toOf(t)} on={t.key === active} n={counts[t.key]} />
            ))}
          </nav>
        )}
      </div>
      {children}
    </div>
  )
}

function FrameBar({ title }: { title: string }) {
  useMobileBar({ title })
  return null
}

/** One Money tab. A plain Link: the lit tab follows `active` (Month end stays lit on the pages reached from it), not the address. */
function TabLink({ tab, to, on, n, phone }: { tab: MoneyTab; to: string; on: boolean; n: number | undefined; phone?: boolean }) {
  // A phone tab with a short word carries its whole name in aria-label. WCAG 2.5.3 (axe label-content-name-mismatch): what is
  // seen, the short word and then the count digit ("Owed 1"), must be the name's first words in that order, so the name is
  // "Owed, 1 need you, Who owes us" and the badge adds no words of its own (checked against axe 4.14 in Chromium).
  const named = Boolean(phone && tab.short !== tab.label)
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      aria-label={named ? `${tab.short}${n ? `, ${n} need you` : ''}, ${tab.label}` : undefined}
      className={cn(
        'inline-flex items-center rounded border font-medium transition-colors duration-fast ease-out',
        phone ? 'min-h-touch min-w-0 flex-auto justify-center gap-1 px-1 text-xs' : 'min-h-control gap-2 px-4 text-sm',
        on ? 'border-fg bg-surface text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      <span className="whitespace-nowrap">{phone ? tab.short : tab.label}</span>
      {phone && n ? (
        <>
          {/* a space between the word and the count, so the text read for label-in-name is "Owed 1", not "Owed1" */}{' '}
          {/* Under 360 px four labels and their counts do not fit one row: the count becomes a dot (the name still says it). */}
          <span className="max-[359px]:hidden">
            <NeedsCount n={n} silent={named} />
          </span>
          <i aria-hidden="true" className="hidden size-2 shrink-0 rounded-round bg-tone-warning-fg max-[359px]:block" />
        </>
      ) : (
        <NeedsCount n={n} />
      )}
    </Link>
  )
}

/**
 * The heading of a view reached from a Money tab rather than being one (Match bank statement, Margins, Things to check): a
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
        <h2 className="text-xl font-semibold tracking-snug max-md:sr-only">{title}</h2>
        {meta}
        <span className="flex-1 max-md:hidden" />
        {actions}
      </div>
    </div>
  )
}
