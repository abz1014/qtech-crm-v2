import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { useGstRegister } from '@/features/money/invoices/hooks'
import { MONEY_TABS } from '@/features/money/moneyTabs'
import { useReceivables } from '@/features/money/payments/hooks'
import { isOpen } from '@/features/money/payments/model'
import { useMonthEndStatus } from '@/features/money/monthEnd/hooks'
import { buildChecklist, checksWithItems, defaultMonthEndMonth } from '@/features/money/monthEnd/model'

/*
 * The frame every Money tab sits in (g2-month-end, g2-money): the title, the date and currency line, the page actions
 * and the strip of Money views. Each view task adds its own entry to MONEY_TABS and renders <MoneyFrame> around itself.
 * Only the views that exist are listed; the mockup's others (Month-end, Margins, Exchange rates) arrive with their own
 * tasks. GST register and Receivables carry their counts (invoices, open orders), read through the same queries their
 * pages use, so the numbers cost no extra request. Sales see "Order balances" in place of Receivables and no Expenses.
 */
const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function MoneyFrame({ active, actions, children }: { active: string; actions?: ReactNode; children: ReactNode }) {
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const isAdmin = role === 'admin'
  const money = role === 'admin' || role === 'sales'
  const tabs = MONEY_TABS.filter(t => isAdmin || !t.adminOnly)
  const register = useGstRegister(money)
  const receivables = useReceivables(money)
  // Month-end carries the number of checks that have items for the month that just ended (admin only: no request for anyone else).
  const monthEnd = defaultMonthEndMonth(businessToday())
  const checks = useMonthEndStatus(monthEnd, isAdmin)
  const counts: Record<string, number | undefined> = {
    'gst-register': register.data?.length,
    receivables: receivables.data?.filter(isOpen).length,
    'month-end': checks.data ? checksWithItems(buildChecklist(checks.data, monthEnd)) : undefined,
  }
  return (
    <div className="grid w-full min-w-0 content-start gap-4 px-4 pb-12 pt-6 md:px-10">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <span>{longDay.format(new Date(`${businessToday()}T12:00:00+05:00`))}</span>
              <i aria-hidden="true" className="size-[3px] rounded-round bg-fg-muted" />
              <span>All amounts in PKR</span>
            </p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        <nav aria-label="Money views" className="inline-flex max-w-full gap-[2px] justify-self-start overflow-x-auto rounded bg-selected p-[2px]">
          {tabs.map(t => (
            <NavLink
              key={t.key}
              to={t.to}
              className={cn(
                'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded border px-3 text-xs font-medium transition-colors duration-fast ease-out',
                t.key === active ? 'border-line-strong bg-surface text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
              aria-current={t.key === active ? 'page' : undefined}
            >
              {isAdmin ? t.label : (t.salesLabel ?? t.label)}
              {counts[t.key] !== undefined ? <span className="num ml-2 font-regular">{counts[t.key]}</span> : null}
            </NavLink>
          ))}
        </nav>
      </header>
      {children}
    </div>
  )
}
