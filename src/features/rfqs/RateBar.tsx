import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRate } from '@/lib/money'
import { Icon } from '@/ui/Icon'
import { rateBarNote, type RateBarEntry } from '@/features/fx/ratesModel'

/*
 * The rate bar above the items (g2-rfq-detail .ratebar; grade-B R5): ONE line, "Rates today: AED 76.40 · CNY 38.90 · … Edit".
 * A fresh rate is just its figure (where it came from and its age are in its title); a stale rate is amber with its age; a currency
 * with no usable rate says it is not compared. "Edit" goes to Settings > Exchange rates, where anyone on the team can add a rate.
 * On a phone the line is behind a "Rates" toggle, so it does not take six lines above the first item. Nothing here blocks a price
 * (BUILD_PLAN A3/A4).
 */
export function RateBar({ entries }: { entries: readonly RateBarEntry[] }) {
  const [open, setOpen] = useState(false)
  const lineId = useId()
  const trouble = entries.filter(e => e.ratePkr === null || e.staleness === 'unusable' || e.staleness === 'stale').length
  return (
    <div className="border-b bg-sunken text-sm text-fg-2" data-ratebar>
      <button
        type="button"
        className="flex min-h-touch w-full items-center gap-2 px-5 text-left font-medium md:hidden"
        aria-expanded={open}
        aria-controls={lineId}
        onClick={() => setOpen(o => !o)}
      >
        Rates
        {trouble > 0 ? <span className="font-regular text-tone-warning-fg">{`· ${trouble} need a look`}</span> : null}
        <Icon icon={ChevronDown} size="sm" className={cn('ml-auto transition-transform', open && 'rotate-180')} />
      </button>
      <p id={lineId} className={cn('flex-wrap items-center gap-x-1 gap-y-1 px-5 py-2 md:flex', open ? 'flex max-md:pt-0' : 'hidden')}>
        <span className="mr-1 text-fg-muted">Rates today, PKR per unit:</span>
        {entries.length === 0 ? <span className="text-fg-muted">none yet</span> : null}
        {entries.map((e, n) => (
          <span key={e.currency} className="inline-flex items-center gap-1">
            {n > 0 ? (
              <span aria-hidden="true" className="text-fg-muted">
                ·
              </span>
            ) : null}
            {e.ratePkr === null || e.staleness === 'unusable' ? (
              <span className="inline-flex items-center gap-1 text-fg-muted" data-rate={e.currency} data-band={e.staleness ?? 'none'}>
                <Icon icon={Info} size="chip" />
                <b className="font-medium text-fg-2">{e.currency}</b>
                {e.ratePkr === null ? 'no rate, not compared' : `rate ${e.ageDays} days old, not compared`}
              </span>
            ) : (
              <span
                className={e.staleness === 'stale' ? 'inline-flex items-center gap-1 text-tone-warning-fg' : 'inline-flex items-center gap-1'}
                data-rate={e.currency}
                data-band={e.staleness ?? 'fresh'}
                title={rateBarNote(e)}
              >
                {e.staleness === 'stale' ? <Icon icon={TriangleAlert} size="chip" /> : null}
                <b className="num font-medium">{`${e.currency} ${formatRate(e.ratePkr)}`}</b>
                {e.staleness === 'stale' ? <span>{`${e.ageDays} days old`}</span> : null}
              </span>
            )}
          </span>
        ))}
        <Link to="/settings/exchange-rates" aria-label="Edit exchange rates" className="ml-auto rounded font-medium underline underline-offset-2 hover:text-fg max-md:ml-0">
          Edit
        </Link>
      </p>
    </div>
  )
}
