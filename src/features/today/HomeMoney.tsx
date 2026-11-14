import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { qk } from '@/features/queryKeys'
import { loadCashFlow } from '@/features/money/inOut/api'
import { useReceivablesSummary } from '@/features/money/payments/hooks'

/*
 * The money pulse on Home (Forest 10-home.html, F-614): admin and sales only. Never drawn for an engineer: the screen renders it
 * behind seesPrices(), so an engineer makes no request either. Every figure is read from where the Money pages read it, so
 * the numbers agree with them:
 *   To collect            receivables_summary (the same Outstanding as Money home and To collect), the late part in red words
 *   Received this month   the In vs out month row (admin only, as on Money home)
 * Each card is a link-out to its page; nothing is worked out here.
 */
const pkr = (n: number | string) => `PKR ${formatAmount(n, 'never')}`
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function HomeMoney({ today, admin }: { today: string; admin: boolean }) {
  return (
    <div className="grid gap-card-gap" data-home-money="">
      <ToCollect today={today} />
      {admin ? <Received today={today} /> : null}
    </div>
  )
}

function ToCollect({ today }: { today: string }) {
  const q = useReceivablesSummary(today)
  const s = q.data
  return (
    <section aria-labelledby="home-to-collect" className="grid gap-2 rounded-card border bg-surface p-card shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-to-collect" className="text-lg font-card">To collect</h2>
        {s && s.overdue > 0 ? (
          <span className="num inline-flex items-center gap-1 rounded-pill bg-tone-danger-bg px-3 py-1 text-sm font-semibold text-tone-danger-fg">
            <Icon icon={Clock} size="sm" /> {pkr(s.overdue)} late
          </span>
        ) : null}
      </div>
      {q.isPending ? (
        <div aria-busy="true" className="grid gap-2"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      ) : q.isError ? (
        <p className="text-base text-fg-muted">
          Could not be read. <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>Try again</button>
        </p>
      ) : (
        <>
          <p className="num text-kpi font-heavy">{pkr(s?.outstanding ?? 0)}</p>
          <p className="text-base text-fg-muted">
            {s && s.openCount > 0 ? `${plural(s.openCount, 'open order')}, ${s.overdueCount > 0 ? `${s.overdueCount} late` : 'nothing late'}.` : 'Nothing to collect.'}
          </p>
        </>
      )}
      <Link to="/money/receivables" className="inline-flex min-h-control items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-base font-bold text-fg hover:bg-selected">
        Open To collect
      </Link>
    </section>
  )
}

function Received({ today }: { today: string }) {
  const q = useQuery({ queryKey: qk.money.monthEnd.cashFlow(), queryFn: loadCashFlow, staleTime: 0 })
  const month = today.slice(0, 7)
  // a month with no row yet has had no money in: zero, as on Money home
  const row = useMemo(() => q.data?.find(f => f.month === month) ?? null, [q.data, month])
  return (
    <section aria-labelledby="home-received" className="grid gap-2 rounded-card border bg-surface p-card shadow-e1">
      <h2 id="home-received" className="text-lg font-card">Received this month</h2>
      {q.isPending ? (
        <div aria-busy="true" className="grid gap-2"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      ) : q.isError ? (
        <p className="text-base text-fg-muted">
          Could not be read. <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>Try again</button>
        </p>
      ) : (
        <>
          <p className="num text-kpi font-heavy">{pkr(row?.moneyIn ?? '0.00')}</p>
          <p className="text-base text-fg-muted">{row && row.payments > 0 ? plural(row.payments, 'payment') : 'No payment yet this month'}</p>
        </>
      )}
    </section>
  )
}
