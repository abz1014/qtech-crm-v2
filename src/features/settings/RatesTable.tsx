import { useMemo } from 'react'
import { useFxLatest } from '@/features/rfqs/hooks'
import type { FxLatestRow } from '@/features/rfqs/api'
import { rateAgeLabel, sortRates, sourceLabel } from '@/features/settings/ratesModel'
import { formatDay } from '@/lib/formatDay'
import { formatRate } from '@/lib/money'
import { DataTable, type Column } from '@/ui/DataTable'
import { StatusBadge } from '@/ui/StatusBadge'

/*
 * The exchange-rate table (g2-login-team-settings, Settings home): Currency, PKR for 1 unit, Source,
 * As of, Rate age. The age reads the same bands as the price comparison (fresh up to 7 days, stale 8 to 30,
 * unusable over 30), straight from v_fx_latest, so an old rate looks old everywhere. A fresh rate shows its age
 * as plain text; only "Old rate" and "No rate" are chips (round 2, spec 1.5).
 * Read-only: entering a rate by hand happens inline where a price needs it.
 */
function RateAge({ r }: { r: FxLatestRow }) {
  if (r.staleness === 'fresh') return <span className="num text-fg-2">{rateAgeLabel(r)}</span>
  return <StatusBadge dimension="fx" value={r.staleness} detail={`${r.ageDays} ${r.ageDays === 1 ? 'day' : 'days'} old`} />
}

const COLUMNS: Column<FxLatestRow>[] = [
  { id: 'currency', header: 'Currency', value: r => r.currency, cell: r => <b className="num font-medium">{r.currency}</b> },
  { id: 'rate', header: 'PKR for 1 unit', kind: 'num', value: r => r.ratePkr, cell: r => formatRate(r.ratePkr) },
  { id: 'source', header: 'Source', value: r => sourceLabel(r.source) },
  { id: 'asOf', header: 'As of', value: r => r.asOf, cell: r => <span className="num">{formatDay(r.asOf)}</span> },
  {
    id: 'age',
    header: 'Rate age',
    value: r => r.ageDays,
    cell: r => <RateAge r={r} />,
  },
]

export function RatesTable({ label = 'Exchange rates' }: { label?: string }) {
  const q = useFxLatest()
  const rows = useMemo(() => sortRates(q.data ?? []), [q.data])
  return (
    <DataTable
      label={label}
      columns={COLUMNS}
      rows={rows}
      getRowId={r => r.currency}
      defaultSort={null}
      loading={q.isLoading}
      error={
        q.isError
          ? { title: 'Couldn’t load the exchange rates', message: 'Nothing has changed. Check your connection, then try again.', onRetry: () => void q.refetch() }
          : null
      }
      empty={<p className="px-6 py-10 text-center text-sm text-fg-muted">No rates yet. They arrive every night, or enter one where a price needs it.</p>}
      mobileRow={r => (
        <span className="grid gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <b className="num font-medium">{r.currency}</b>
            <span className="num">{formatRate(r.ratePkr)}</span>
          </span>
          <span className="flex items-center justify-between gap-3 text-xs text-fg-muted">
            <span>{`${sourceLabel(r.source)} · ${formatDay(r.asOf)}`}</span>
            <RateAge r={r} />
          </span>
        </span>
      )}
    />
  )
}
