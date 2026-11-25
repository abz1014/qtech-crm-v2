import type { ReactNode } from 'react'
import { History, Pencil, Plus, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRate } from '@/lib/money'
import { Button } from '@/ui/Button'
import { DataTable, type Column, type DataTableProps } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { ageText, bandDetail, rateCardLine, rateDay, sourceText, type RateRow } from '@/features/fx/ratesModel'

/*
 * The one exchange-rate table (screen review 2026-11-24, item 21: Settings home and Settings > Exchange rates drew the rates
 * two ways, with other column titles, another row order and another date format). Currency with its name, "Rate, PKR",
 * "As of" with the source under it, and "Age". The rows come from buildRateRows, so the order is the same everywhere.
 * With `onAdd` and `onHistory` each row gets "Add rate" and "History"; without them the table is read-only.
 */
export const RATE_TABLE_LABEL = 'Latest rate per currency'

interface RowActionsProps {
  r: RateRow
  onAdd: (c: string) => void
  onHistory: (c: string) => void
  touch?: boolean
}

function RowActions({ r, onAdd, onHistory, touch }: RowActionsProps) {
  // In the table the two actions are icon buttons (a name and a tooltip each) so the Actions column stays narrow; on a phone they are words.
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', touch ? '-ml-3 justify-start' : 'justify-end')}>
      {touch ? (
        <>
          <Button size="touch" variant="quiet" icon={Plus} onClick={() => onAdd(r.currency)} aria-label={`Add rate for ${r.currency}`}>
            Add rate
          </Button>
          <Button size="touch" variant="quiet" icon={History} onClick={() => onHistory(r.currency)} aria-label={`History of ${r.currency}`}>
            History
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="quiet" icon={Plus} onClick={() => onAdd(r.currency)} aria-label={`Add rate for ${r.currency}`} title="Add rate" />
          <Button size="sm" variant="quiet" icon={History} onClick={() => onHistory(r.currency)} aria-label={`History of ${r.currency}`} title="History" />
        </>
      )}
    </span>
  )
}

function AgeCell({ r }: { r: RateRow }) {
  if (r.staleness === null || r.ageDays === null) return <span className="text-fg-muted">—</span>
  if (r.staleness === 'fresh') return <span className="num text-fg-2">{ageText(r.ageDays)}</span>
  // the badge and, under it, how old: one line each, so a stale rate does not widen the table
  return (
    <span className="grid justify-items-start gap-px">
      <StatusBadge dimension="fx" value={r.staleness} />
      <span className="text-base text-fg-muted">{bandDetail(r.ageDays)}</span>
    </span>
  )
}

interface RateTableProps {
  rows: RateRow[]
  onAdd?: (c: string) => void
  onHistory?: (c: string) => void
  loading?: boolean
  error?: DataTableProps<RateRow>['error']
  empty?: ReactNode
  className?: string
}

export function RateTable({ rows, onAdd, onHistory, loading, error, empty, className }: RateTableProps) {
  const actions = onAdd && onHistory ? { onAdd, onHistory } : null
  const columns: Column<RateRow>[] = [
    {
      id: 'currency',
      header: 'Currency',
      value: r => r.currency,
      cell: r => (
        <span className="grid">
          <span className="font-medium">{r.currency}</span>
          <span className="text-base text-fg-muted">{r.name}</span>
        </span>
      ),
    },
    {
      id: 'rate',
      header: 'Rate, PKR',
      kind: 'num',
      value: r => r.ratePkr,
      cell: r => (r.ratePkr === null ? <span className="font-sans text-fg-muted">No rate yet</span> : <span className="num">{formatRate(r.ratePkr)}</span>),
    },
    {
      // The source sits under the date (it was a column of its own, which made the table scroll sideways in the Settings box).
      id: 'asof',
      header: 'As of',
      kind: 'date',
      value: r => r.asOf,
      cell: r =>
        r.asOf ? (
          <span className="grid">
            <span className="num">{rateDay(r.asOf)}</span>
            {r.source ? (
              <span className="inline-flex items-center gap-1 text-base text-fg-muted">
                <Icon icon={r.source === 'manual' ? Pencil : RefreshCw} size="sm" />
                {sourceText(r.source)}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    { id: 'age', header: 'Age', value: r => r.ageDays, cell: r => <AgeCell r={r} /> },
  ]
  if (actions) {
    columns.push({
      id: 'action',
      header: 'Actions', // read by assistive tech only; the header text is hidden by the table's className below
      align: 'right',
      cell: r => <RowActions r={r} {...actions} />,
    })
  }
  return (
    <DataTable
      label={RATE_TABLE_LABEL}
      columns={columns}
      rows={rows}
      getRowId={r => r.currency}
      defaultSort={null}
      twoLine
      loading={loading}
      error={error}
      empty={empty}
      className={cn(actions && '[&_thead_th:last-child]:text-transparent', className)}
      mobileRow={r => (
        <span className="grid gap-2">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 text-base font-medium" data-rate-card={r.currency}>
              {rateCardLine(r)}
            </span>
            <AgeCell r={r} />
          </span>
          {actions ? <RowActions r={r} {...actions} touch /> : null}
        </span>
      )}
    />
  )
}
