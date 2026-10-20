import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChartColumn, ChevronLeft } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { Icon } from '@/ui/Icon'
import { computeReconciliationExceptions } from '@/lib/reconciliation'
import { useReconciliationInput } from '@/features/money/hooks'
import { useGstRegister } from '@/features/money/invoices/hooks'
import { needsAttention } from '@/features/money/invoices/model'
import { MONEY_TABS } from '@/features/money/moneyTabs'
import { useClosedMonths, useMonthEndStatus } from '@/features/money/monthEnd/hooks'
import { buildChecklist, checksWithItems, defaultMonthEndMonth, isMonthKey } from '@/features/money/monthEnd/model'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'
import { NeedsCount } from '@/ui/Tag'

/*
 * The frame every Money view sits in: the title, the date and currency line, the page actions, the Reports link and the
 * four Money tabs (owner decision 2026-10-19: two levels, never a third strip). On a phone the tabs wrap into a grid, so no
 * option hides off-screen. A count beside a tab means "needs you", nothing else:
 *   Who owes us     exactly Today's payment items for this person: overdue, not reminded for 7 working days, routed by owner
 *                   (sales see their own orders; admin the rest), snoozes respected. It reads Today's list, which the top bar
 *                   already loads.
 *   Invoices & GST  invoices that need attention (tax not deposited after the month, a step out of order), admin and sales
 *   Month end       admin only, while the month that just ended is open: the checks with items, plus Things to check when the
 *                   reconciliation finds something; the same number the checklist page says
 */
const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function MoneyFrame({ active, actions, children }: { active: string | null; actions?: ReactNode; children: ReactNode }) {
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
  const things = useMemo(() => (recon.data ? computeReconciliationExceptions(recon.data).length : 0), [recon.data])
  const counts: Record<string, number | undefined> = {
    receivables: todayView.view?.active.filter(i => i.rule === 'payment_overdue').length,
    'gst-register': register.data?.filter(needsAttention).length,
    'month-end': checks.data && monthOpen ? checksWithItems(buildChecklist(checks.data, monthEnd)) + (things > 0 ? 1 : 0) : undefined,
  }
  return (
    <div className="grid w-full min-w-0 content-start gap-4 px-4 pb-12 pt-6 md:px-10">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <span>{longDay.format(new Date(`${today}T12:00:00+05:00`))}</span>
              <i aria-hidden="true" className="size-[3px] rounded-round bg-fg-muted" />
              <span>All amounts in PKR</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <Link
              to={{ pathname: '/money/reports', search: month ? `?month=${month}` : '' }}
              aria-current={active === 'reports' ? 'page' : undefined}
              className={cn(
                'inline-flex h-control items-center gap-2 rounded border px-3 text-sm font-medium transition-colors duration-fast hover:bg-sunken',
                active === 'reports' ? 'border-fg bg-selected text-fg' : 'border-line-strong bg-surface text-fg',
              )}
            >
              <Icon icon={ChartColumn} className="text-fg-muted" />
              Reports
            </Link>
          </div>
        </div>
        <nav
          aria-label="Money views"
          className="grid grid-cols-2 gap-[2px] rounded bg-selected p-[2px] md:inline-flex md:max-w-full md:justify-self-start"
        >
          {tabs.map(t => {
            const on = t.key === active
            const n = counts[t.key]
            return (
              // A plain Link: the lit tab follows `active` (Month end stays lit on the pages reached from it), not the address.
              <Link
                key={t.key}
                to={t.to}
                className={cn(
                  'inline-flex min-h-control items-center justify-center gap-2 rounded border px-4 text-sm font-medium transition-colors duration-fast ease-out md:justify-start',
                  on ? 'border-fg bg-surface text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )}
                aria-current={on ? 'page' : undefined}
              >
                {t.label}
                <NeedsCount n={n} />
              </Link>
            )
          })}
        </nav>
      </header>
      {children}
    </div>
  )
}

/**
 * The heading of a view reached from a Money tab rather than being one (Match bank statement, Margins, Things to check, a
 * report): a back link to where it was opened from, the title and its actions. It replaces the old third strip of tabs.
 * On a phone the back link is the phone bar's own back arrow (one bar, UX audit 2026-10-19), so it is not drawn twice.
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
        <h2 className="text-xl font-semibold tracking-snug">{title}</h2>
        {meta}
        <span className="flex-1" />
        {actions}
      </div>
    </div>
  )
}
