import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { buttonStyles } from '@/ui/buttonStyles'
import { CARD } from '@/ui/card'
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
// Each tile is its own container, so its figure is sized by the tile (Figure below).
const TILE = 'grid min-w-0 content-start gap-2 p-card [container-type:inline-size]'
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function HomeMoney({ today, admin }: { today: string; admin: boolean }) {
  // Side by side only when the list column holds two tiles of a readable width (audit: at 768 and 1024 the column is ~300 px, and
  // two tiles there cut the figure and the late chip). The column's own width decides, not the window's.
  return (
    <div className="[container-type:inline-size]" data-home-money="">
      <div className={admin ? 'grid gap-card-gap [@container(min-width:36rem)]:grid-cols-2' : 'grid gap-card-gap'}>
        <ToCollect today={today} />
        {admin ? <Received today={today} /> : null}
      </div>
    </div>
  )
}

/*
 * The tile's big figure. It never breaks inside the digits and never leaves the tile: the size is the KPI size until the figure's
 * own length no longer fits the tile, then it steps down with the tile's width (container units), to the body size at the least.
 * A Geist heavy tabular digit is ~0.62 em wide, so a figure of n characters needs ~0.62n em.
 */
function Figure({ text }: { text: string }) {
  return (
    <p
      className="num whitespace-nowrap font-heavy leading-tight"
      style={{ fontSize: `min(var(--text-kpi), max(var(--text-base), calc(100cqi / ${(text.length * 0.62).toFixed(2)})))` }}
      title={text}
    >
      {text}
    </p>
  )
}

function ToCollect({ today }: { today: string }) {
  const q = useReceivablesSummary(today)
  const s = q.data
  return (
    <section aria-labelledby="home-to-collect" className={cn(CARD, TILE)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-to-collect" className="text-lg font-card">To collect</h2>
        {s && s.overdue > 0 ? (
          // the chip may wrap inside the tile (a digit group never breaks); it never leaves the tile
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-pill bg-tone-danger-bg px-3 py-1 text-sm font-semibold text-tone-danger-fg">
            <Icon icon={Clock} size="sm" />
            <span className="num min-w-0">{pkr(s.overdue)} late</span>
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
          <Figure text={pkr(s?.outstanding ?? 0)} />
          <p className="text-base text-fg-muted">
            {s && s.openCount > 0 ? `${plural(s.openCount, 'open order')}, ${s.overdueCount > 0 ? `${s.overdueCount} late` : 'nothing late'}.` : 'Nothing to collect.'}
          </p>
        </>
      )}
      <Link to="/money/receivables" className={cn(buttonStyles({ variant: 'secondary' }), 'mt-1 w-full')}>
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
    <section aria-labelledby="home-received" className={cn(CARD, TILE)}>
      <h2 id="home-received" className="text-lg font-card">Received this month</h2>
      {q.isPending ? (
        <div aria-busy="true" className="grid gap-2"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      ) : q.isError ? (
        <p className="text-base text-fg-muted">
          Could not be read. <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>Try again</button>
        </p>
      ) : (
        <>
          <Figure text={pkr(row?.moneyIn ?? '0.00')} />
          <p className="text-base text-fg-muted">{row && row.payments > 0 ? plural(row.payments, 'payment') : 'No payment yet this month'}</p>
        </>
      )}
    </section>
  )
}
