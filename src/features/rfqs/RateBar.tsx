import { Link } from 'react-router-dom'
import { Info, TriangleAlert } from 'lucide-react'
import { formatRate } from '@/lib/money'
import { Icon } from '@/ui/Icon'
import { rateBarNote, type RateBarEntry } from '@/features/fx/ratesModel'

/*
 * The rate bar above the items (g2-rfq-detail .ratebar): today's rate per currency that matters on this RFQ, how old it is and
 * where it came from; a stale rate is amber; a currency with no usable rate says it is not compared. The link goes to
 * Settings > Exchange rates, where anyone on the team can add a rate. Nothing here blocks a price (BUILD_PLAN A3/A4).
 */
export function RateBar({ entries }: { entries: readonly RateBarEntry[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-sunken px-5 py-2 text-xs text-fg-2" data-ratebar>
      <span className="text-fg-muted">Today&apos;s rates, PKR per unit</span>
      {entries.length === 0 ? <span className="text-fg-muted">No rates yet</span> : null}
      {entries.map(e =>
        e.ratePkr === null || e.staleness === 'unusable' ? (
          <span key={e.currency} className="inline-flex items-center gap-1 text-fg-muted" data-rate={e.currency} data-band={e.staleness ?? 'none'}>
            <Icon icon={Info} size="chip" />
            <b className="font-medium text-fg-2">{e.currency}</b>
            {e.ratePkr === null ? 'no rate, not compared' : `rate ${e.ageDays} days old, not compared`}
          </span>
        ) : (
          <span
            key={e.currency}
            className={e.staleness === 'stale' ? 'inline-flex items-center gap-1 text-tone-warning-fg' : 'inline-flex items-center gap-1'}
            data-rate={e.currency}
            data-band={e.staleness ?? 'fresh'}
          >
            {e.staleness === 'stale' ? <Icon icon={TriangleAlert} size="chip" /> : null}
            <b className="num font-medium">{`${e.currency} ${formatRate(e.ratePkr)}`}</b>
            <span className={e.staleness === 'stale' ? '' : 'text-fg-muted'}>{rateBarNote(e)}</span>
          </span>
        ),
      )}
      <Link to="/settings/exchange-rates" className="ml-auto rounded font-medium underline underline-offset-2 hover:text-fg">
        Exchange rates
      </Link>
    </div>
  )
}
