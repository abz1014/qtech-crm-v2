import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, CircleCheck, Clock, Plus, Receipt } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { buttonStyles } from '@/ui/buttonStyles'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { CashInHandLine } from '@/features/money/expenses/CashInHand'
import { OwedToStaff } from '@/features/money/expenses/OwedToStaff'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { useMoneyHome } from '@/features/money/home/hooks'
import { ACCOUNTS_LINKS, countWord, type MoneyHomeFigures } from '@/features/money/home/model'

/*
 * Money home (P6-A, owner-approved direction C: colour blocks). Admin only; sales go straight to To collect. Four blocks, one idea
 * each, 16 px and up, each a link to where the number comes from: To collect (the blue block; the only red is the late part inside
 * it), Received, Paid out, We owe suppliers. Below them, in words: cash is not profit (with the GST inside what came in), the profit
 * of the last finished month one click away, and the cash in hand. Accounts, the monthly work, is one level down.
 * The one green button is Add expense.
 * Forest (50-money-hub.html#hub-ok): To collect is the hero, the one forest card with its figure in lime and "Open To collect" as
 * its lime button; the late part rides on it as a chip. Received, Paid out and Payable to suppliers are three white KPI cards
 * under it. Owed to staff and Cash in hand sit side by side when both show and there is room; one alone takes the full width.
 */
const rs = (v: string | number) => formatAmount(v, 'never')

export function MoneyHome() {
  const today = businessToday()
  const { figures: f, isError, refetch } = useMoneyHome(today)
  const go = useNavigate()
  return (
    <MoneyFrame
      active={null}
      title="Money"
      morePages={false}
      actions={
        <Button variant="primary" icon={Plus} onClick={() => go('/money/expenses')} className="text-base">
          Add expense
        </Button>
      }
    >
      {isError ? (
        <Banner
          tone="danger"
          title="Some of these numbers could not be loaded."
          action={
            <Button variant="quiet" onClick={refetch}>
              Try again
            </Button>
          }
        />
      ) : null}
      <Blocks f={f} />
      <Sentences f={f} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,30rem),1fr))] items-start gap-card-gap [&>*]:min-w-0">
        <OwedToStaff summary />
        <CashInHandLine />
      </div>
      <Accounts />
    </MoneyFrame>
  )
}

function Blocks({ f }: { f: MoneyHomeFigures }) {
  return (
    <section aria-label={`Money, ${f.monthName} so far`} className="grid grid-cols-[minmax(0,1fr)] gap-card-gap" data-testid="money-blocks">
      <Hero f={f} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-card-gap min-[480px]:grid-cols-2 lg:grid-cols-3">
        <Block
          to="/money/reports/in-out"
          label={`Received in ${f.monthName}`}
          value={f.received ? rs(f.received.total) : null}
          sub={f.received ? `${countWord(f.received.count, 'payment')}, GST included` : null}
        />
        <Block to="/money/expenses" label={`Paid out in ${f.monthName}`} value={f.paidOut ? rs(f.paidOut.total) : null} sub={f.paidOut ? 'by the day paid' : null} />
        <Block
          to="/money/reports/owe"
          label="Payable to suppliers"
          prefix="about"
          value={f.owed ? rs(f.owed.total) : null}
          sub={f.owed ? countWord(f.owed.count, 'supplier order') : null}
        />
      </div>
    </section>
  )
}

/** To collect, the hero: the forest card (data-surface re-inks the words), the figure in lime, the late part as a chip, one lime button. */
function Hero({ f }: { f: MoneyHomeFigures }) {
  const t = f.toCollect
  return (
    <section data-surface="navy" aria-labelledby="money-hero-h" className="grid gap-4 rounded-card bg-hero p-card text-fg shadow-e2">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 flex-[1_1_14rem] gap-1">
          <p className="text-sm font-card text-fg-2">To collect</p>
          <h2 id="money-hero-h" className="text-2xl font-heavy tracking-tight text-pretty">
            {t && t.total <= 0 ? 'Nothing to collect' : 'Customers still owe us'}
          </h2>
        </div>
        {t ? (
          <p className="num min-w-0 text-hero font-heavy text-lime-300 [overflow-wrap:anywhere]">
            <span className="mr-2 text-lg font-card">PKR</span>
            {rs(t.total)}
          </p>
        ) : (
          <Skeleton className="h-[3rem] w-[14rem] max-w-full" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {t ? (
          t.late > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-pill border border-line-strong px-3 py-1 text-sm font-card" data-testid="late-part">
              <Icon icon={Clock} />
              <span>
                <span className="num">PKR {rs(t.late)}</span> late, {countWord(t.lateCount, 'order')}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-pill border border-line-strong px-3 py-1 text-sm font-card">
              <Icon icon={CircleCheck} />
              Nothing is late
            </span>
          )
        ) : null}
        <Link to="/money/receivables" className={buttonStyles({ variant: 'lime', size: 'lg' })}>
          Open To collect
        </Link>
      </div>
    </section>
  )
}

function Block({ to, label, value, prefix = 'PKR', sub }: { to: string; label: string; value: string | null; prefix?: string; sub: ReactNode }) {
  return (
    <Link
      to={to}
      className="grid min-h-touch content-start gap-1 rounded-card border bg-surface p-card shadow-e1 transition-[box-shadow,border-color] duration-fast ease-out hover:border-line-strong hover:shadow-e2"
    >
      <span className="text-base font-card text-fg-2">{label}</span>
      {value === null ? (
        <Skeleton className="h-[2.25rem] w-[10rem] max-w-full" />
      ) : (
        <span className="num text-kpi font-heavy tracking-snug [overflow-wrap:anywhere]">
          <span className="mr-2 text-base font-card">{prefix}</span>
          {value}
        </span>
      )}
      <span className="min-h-6 text-base text-fg-2">{sub}</span>
    </Link>
  )
}

function Sentences({ f }: { f: MoneyHomeFigures }) {
  return (
    <section className="grid gap-3" aria-label="Cash and profit">
      <p className="rounded-card border bg-surface p-card text-lg shadow-e1" data-testid="cash-not-profit">
        <b className="mr-2 font-heavy">Cash, not profit:</b>
        {f.received && f.paidOut ? (
          <>
            PKR <span className="num">{rs(f.received.total)}</span> came in this month
            {f.gstShare && Number(f.gstShare) > 0 ? (
              <>
                , and about <b className="num font-semibold">PKR {rs(f.gstShare)}</b> of it is GST payable to FBR
              </>
            ) : null}
            . PKR <span className="num">{rs(f.paidOut.total)}</span> went out.
          </>
        ) : (
          'Loading.'
        )}
      </p>
      {f.profit ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border bg-surface p-card text-lg shadow-e1" data-testid="profit-line">
          <span>
            <b className="mr-2 font-heavy">Profit, {f.profit.monthName}:</b>
            <b className="num font-semibold">PKR {rs(f.profit.amount)}</b> after GST and costs, on invoices.
          </span>
          <Link
            to={`/money/reports/in-out?by=month&period=${f.profit.monthKey}`}
            className="inline-flex h-control items-center gap-1 rounded-control border border-line-strong bg-surface px-4 text-base font-bold text-fg transition-colors duration-fast ease-out hover:bg-selected"
          >
            Open the profit report
            <Icon icon={ChevronRight} />
          </Link>
        </p>
      ) : null}
    </section>
  )
}

function Accounts() {
  return (
    <section aria-labelledby="accounts-h" className="rounded-card border bg-surface shadow-e1">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <Icon icon={Receipt} className="text-fg-muted" />
        <h2 id="accounts-h" className="text-lg font-heavy">
          Accounts
        </h2>
        <span className="text-base text-fg-2">monthly work</span>
      </header>
      <ul className="grid divide-y md:grid-cols-2 md:divide-y-0">
        {ACCOUNTS_LINKS.map(a => (
          <li key={a.to + a.label} className="md:border-b md:odd:border-r">
            <Link to={a.to} className="flex min-h-row-tall items-center gap-3 px-5 py-3 hover:bg-sunken">
              <span className="grid min-w-0 flex-1">
                <span className="text-base font-card">{a.label}</span>
                <span className="text-base text-fg-2">{a.hint}</span>
              </span>
              <Icon icon={ChevronRight} className="text-fg-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
