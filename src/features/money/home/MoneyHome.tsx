import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, CircleAlert, Plus, Receipt } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { CashInHandLine } from '@/features/money/expenses/CashInHand'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { useMoneyHome } from '@/features/money/home/hooks'
import { ACCOUNTS_LINKS, countWord, type MoneyHomeFigures } from '@/features/money/home/model'

/*
 * Money home (P6-A, owner-approved direction C: colour blocks). Admin only; sales go straight to To collect. Four blocks, one idea
 * each, 16 px and up, each a link to where the number comes from: To collect (the blue block; the only red is the late part inside
 * it), Received, Paid out, We owe suppliers. Below them, in words: cash is not profit (with the GST inside what came in), the profit
 * of the last finished month one click away, and the cash in hand. Accounts, the monthly work, is one level down.
 * The one green button is Add expense.
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
      actions={
        <Button variant="primary" icon={Plus} onClick={() => go('/money/expenses')} className="text-base">
          Add expense
        </Button>
      }
    >
      {isError ? (
        <p role="alert" className="rounded-row border border-tone-danger-fg/30 bg-tone-danger-bg px-4 py-3 text-base text-tone-danger-fg">
          Some of these numbers could not be loaded.{' '}
          <button type="button" className="font-medium underline" onClick={refetch}>
            Try again
          </button>
        </p>
      ) : null}
      <Blocks f={f} />
      <Sentences f={f} />
      <CashInHandLine />
      <Accounts />
    </MoneyFrame>
  )
}

function Blocks({ f }: { f: MoneyHomeFigures }) {
  return (
    <section aria-label={`Money, ${f.monthName} so far`} className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4" data-testid="money-blocks">
      <Block
        to="/money/receivables"
        tone="week"
        label="To collect"
        value={f.toCollect ? rs(f.toCollect.total) : null}
        sub={
          f.toCollect ? (
            f.toCollect.late > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-row bg-block-late px-2 py-1 font-medium text-block-late-fg" data-testid="late-part">
                <Icon icon={CircleAlert} />
                {rs(f.toCollect.late)} late, {countWord(f.toCollect.lateCount, 'order')}
              </span>
            ) : (
              <span>Nothing is late</span>
            )
          ) : null
        }
      />
      <Block
        to="/money/reports/in-out"
        label={`Received in ${f.monthName}`}
        value={f.received ? rs(f.received.total) : null}
        sub={f.received ? `${countWord(f.received.count, 'payment')}, GST included` : null}
      />
      <Block to="/money/expenses" label={`Paid out in ${f.monthName}`} value={f.paidOut ? rs(f.paidOut.total) : null} sub={f.paidOut ? 'by the day paid' : null} />
      <Block
        to="/money/reports/owe"
        label="We owe suppliers"
        prefix="about"
        value={f.owed ? rs(f.owed.total) : null}
        sub={f.owed ? countWord(f.owed.count, 'supplier order') : null}
      />
    </section>
  )
}

function Block({ to, label, value, prefix = 'PKR', sub, tone }: { to: string; label: string; value: string | null; prefix?: string; sub: ReactNode; tone?: 'week' }) {
  return (
    <Link
      to={to}
      className={cn(
        'grid min-h-[44px] content-start gap-1 rounded-panel border px-5 py-4 transition-colors hover:border-line-strong',
        tone === 'week' ? 'border-transparent bg-block-week text-block-week-fg' : 'border-line bg-block-quiet text-block-quiet-fg',
      )}
    >
      <span className="text-base font-medium">{label}</span>
      {value === null ? (
        <Skeleton className="h-[2.25rem] w-[10rem]" />
      ) : (
        <span className="num text-3xl font-semibold leading-tight tracking-snug">
          <span className="mr-1 text-base font-medium opacity-80">{prefix}</span>
          {value}
        </span>
      )}
      <span className="min-h-6 text-base">{sub}</span>
    </Link>
  )
}

function Sentences({ f }: { f: MoneyHomeFigures }) {
  return (
    <section className="grid gap-3" aria-label="Cash and profit">
      <p className="rounded-panel border bg-surface px-5 py-4 text-lg leading-relaxed" data-testid="cash-not-profit">
        <b className="mr-2 font-semibold">Cash, not profit:</b>
        {f.received && f.paidOut ? (
          <>
            PKR <span className="num">{rs(f.received.total)}</span> came in this month
            {f.gstShare && Number(f.gstShare) > 0 ? (
              <>
                , and about <b className="num font-semibold">PKR {rs(f.gstShare)}</b> of it is GST we owe FBR
              </>
            ) : null}
            . PKR <span className="num">{rs(f.paidOut.total)}</span> went out.
          </>
        ) : (
          'Loading.'
        )}
      </p>
      {f.profit ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border bg-surface px-5 py-4 text-lg leading-relaxed" data-testid="profit-line">
          <span>
            <b className="mr-2 font-semibold">Profit, {f.profit.monthName}:</b>
            <b className="num font-semibold">PKR {rs(f.profit.amount)}</b> after GST and costs, on invoices.
          </span>
          <Link
            to={`/money/reports/in-out?by=month&period=${f.profit.monthKey}`}
            className="inline-flex min-h-[44px] items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
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
    <section aria-labelledby="accounts-h" className="rounded-panel border bg-surface">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <Icon icon={Receipt} className="text-fg-muted" />
        <h2 id="accounts-h" className="text-lg font-semibold">
          Accounts
        </h2>
        <span className="text-base text-fg-2">monthly work</span>
      </header>
      <ul className="grid divide-y md:grid-cols-2 md:divide-y-0">
        {ACCOUNTS_LINKS.map(a => (
          <li key={a.to + a.label} className="md:border-b md:odd:border-r">
            <Link to={a.to} className="flex min-h-[56px] items-center gap-3 px-5 py-3 hover:bg-sunken">
              <span className="grid min-w-0 flex-1">
                <span className="text-base font-medium">{a.label}</span>
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
