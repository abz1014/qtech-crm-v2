import { useMemo, useState } from 'react'
import { Pencil, RefreshCw } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatRate } from '@/lib/money'
import { parseAmount } from '@/lib/number'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { PageHeader } from '@/ui/PageHeader'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { Panel } from '@/features/companies/CompanyParts'
import { useFxLatest } from '@/features/rfqs/hooks'
import { useFxHistory, useFxLastAutoRun, useSetFxRate } from '@/features/fx/hooks'
import { ageText, autoRunStamp, bandDetail, buildRateRows, sourceText, unusableWarning, type RateRow } from '@/features/fx/ratesModel'

/*
 * Settings > Exchange rates (R15; g2-money "Admin: exchange rates" and g2-login-team-settings "Settings home, sales").
 * Open to the whole team: any staff member may enter today's rate by hand (fx_rates RLS allows it for source = manual),
 * and a manual rate wins over the automatic one for its own day. The bands are the ones the price comparison uses, so a
 * stale rate looks stale everywhere: fresh up to 7 days, stale 8 to 30, unusable over 30 (not compared).
 *
 * FE-2 entry burden: required = currency and rate. Pre-filled = the currency (the one most in need), the date (today).
 * Round 2: PageHeader with one lede sentence; the background lives in the (i) only (R2-17). The Age column is the age as text
 * for a fresh rate, and a chip only for "Old rate" and "No rate" (spec 1.5).
 */

export function ExchangeRatesPage() {
  const latest = useFxLatest()
  const rows = useMemo(() => buildRateRows(latest.data ?? []), [latest.data])
  const lastRun = useFxLastAutoRun()
  const [picked, setPicked] = useState<string | null>(null)
  // The currency the history and the form show: the one chosen, else the first with a rate, else the first.
  const current = picked ?? rows.find(r => r.ratePkr !== null)?.currency ?? rows[0]?.currency
  const warnings = rows.map(unusableWarning).filter((w): w is string => w !== null)

  return (
    <div className="grid min-w-0 content-start gap-4">
      <PageHeader
        title="Exchange rates"
        lede={
          <>
            Anyone on the team can enter today&apos;s rate by hand.{' '}
            <InfoTip label="About rates">
              Updated every night. Used only to compare supplier prices in PKR, never for invoices. You can enter the bank&apos;s rate instead.
            </InfoTip>
          </>
        }
      />

      {latest.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading the exchange rates" className="grid gap-4">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[200px]" />
        </div>
      ) : latest.isError ? (
        <EmptyState
          mood="error"
          title="Couldn't load the exchange rates"
          actions={
            <Button variant="primary" onClick={() => void latest.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-4">
            <Panel
              title="Exchange rates"
              meta="PKR for 1 unit · latest rate per currency"
              actions={lastRun.data ? <span className="text-xs text-fg-muted" data-fx-auto-run>{autoRunStamp(lastRun.data)}</span> : undefined}
            >
              <RatesTable rows={rows} onPick={setPicked} />
            </Panel>
            {warnings.map(w => (
              <Banner key={w} tone="warning" title={w.split('. ')[0] + '.'}>
                {w.split('. ').slice(1).join('. ')}
              </Banner>
            ))}
            {current ? <HistoryPanel currency={current} currencies={rows.map(r => r.currency)} onPick={setPicked} /> : null}
          </div>
          <AddRateCard key={current} rows={rows} initial={current} onPick={setPicked} />
        </div>
      )}
    </div>
  )
}

function RatesTable({ rows, onPick }: { rows: RateRow[]; onPick: (c: string) => void }) {
  const day = (iso: string) => formatDay(iso).replace(/^\w+ /, '')
  const columns: Column<RateRow>[] = [
    {
      id: 'currency',
      header: 'Currency',
      value: r => r.currency,
      cell: r => (
        <span className="grid">
          <span className="font-medium">{r.currency}</span>
          <span className="text-xs text-fg-muted">{r.name}</span>
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
    { id: 'asof', header: 'As of', kind: 'date', value: r => r.asOf, cell: r => (r.asOf ? <span className="num">{day(r.asOf)}</span> : <span className="text-fg-muted">—</span>) },
    {
      id: 'source',
      header: 'Source',
      hideBelowMd: true,
      value: r => r.source,
      cell: r =>
        r.source ? (
          <span className="inline-flex items-center gap-1 text-fg-2">
            <Icon icon={r.source === 'manual' ? Pencil : RefreshCw} size="sm" className="text-fg-muted" />
            {sourceText(r.source)}
          </span>
        ) : (
          <span className="text-fg-muted">{sourceText(null)}</span>
        ),
    },
    {
      id: 'age',
      header: 'Age',
      value: r => r.ageDays,
      cell: r =>
        r.staleness === null || r.ageDays === null ? (
          <span className="text-fg-muted">—</span>
        ) : r.staleness === 'fresh' ? (
          <span className="num text-fg-2">{ageText(r.ageDays)}</span>
        ) : (
          <StatusBadge dimension="fx" value={r.staleness} detail={bandDetail(r.ageDays)} />
        ),
    },
    {
      id: 'action',
      header: 'Add a rate',
      align: 'right',
      cell: r =>
        r.staleness !== 'fresh' ? (
          <Button size="sm" variant="quiet" onClick={() => onPick(r.currency)} aria-label={`Add rate for ${r.currency}`}>
            Add rate
          </Button>
        ) : null,
    },
  ]
  return <DataTable label="Latest exchange rate per currency" columns={columns} rows={rows} getRowId={r => r.currency} twoLine />
}

function HistoryPanel({ currency, currencies, onPick }: { currency: string; currencies: string[]; onPick: (c: string) => void }) {
  const history = useFxHistory(currency)
  return (
    <Panel
      title={`Recent ${currency} rates`}
      meta="A rate entered by hand wins for its own day"
      actions={
        <Select
          aria-label="Show the history of"
          className="w-[96px]"
          value={currency}
          onChange={e => onPick(e.target.value)}
          options={currencies.map(c => ({ value: c, label: c }))}
        />
      }
    >
      {history.isPending ? (
        <Skeleton className="m-5 h-24" />
      ) : history.isError ? (
        <p className="px-5 py-4 text-sm text-fg-muted">The history did not load. Try again in a moment.</p>
      ) : history.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">{`No ${currency} rate has been recorded yet.`}</p>
      ) : (
        <ul>
          {history.data.map(h => (
            <li key={`${h.asOf}-${h.source}`} className="flex items-center gap-4 border-t px-5 py-3 text-sm first:border-t-0">
              <span className="num w-[72px] shrink-0">{formatDay(h.asOf).replace(/^\w+ /, '')}</span>
              <span className="inline-flex items-center gap-1 text-fg-2">
                <Icon icon={h.source === 'manual' ? Pencil : RefreshCw} size="sm" className="text-fg-muted" />
                {sourceText(h.source)}
              </span>
              <span className="num ml-auto">{formatRate(h.ratePkr)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function AddRateCard({ rows, initial, onPick }: { rows: RateRow[]; initial: string | undefined; onPick: (c: string) => void }) {
  const { toast } = useToast()
  const save = useSetFxRate()
  const [currency, setCurrency] = useState(initial ?? 'USD')
  const [rateText, setRateText] = useState('')
  const [asOf, setAsOf] = useState(businessToday())
  const history = useFxHistory(currency)
  const lastAuto = history.data?.find(h => h.source === 'auto')
  const rate = parseAmount(rateText)
  const invalid = rateText.trim() !== '' && (rate === null || rate <= 0)

  const submit = async () => {
    if (rate === null || rate <= 0) return
    try {
      await save.mutateAsync({ currency, ratePkr: rate, asOf: asOf || undefined })
      toast({ title: 'Rate saved', body: `${currency} ${formatRate(rate)} for ${formatDay(asOf)}`, tone: 'success' })
      setRateText('')
    } catch (err) {
      toast({ title: 'Could not save the rate', body: mapPgError(err, { entity: 'rate' }).message, tone: 'danger' })
    }
  }

  return (
    <Panel title="Add a rate by hand">
      <form
        className="grid gap-4 px-5 py-4"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Currency" help={lastAuto ? `Last automatic: ${formatRate(lastAuto.ratePkr)} on ${formatDay(lastAuto.asOf).replace(/^\w+ /, '')}` : undefined}>
          <Select
            value={currency}
            onChange={e => {
              setCurrency(e.target.value)
              onPick(e.target.value)
            }}
            options={rows.map(r => ({ value: r.currency, label: r.currency }))}
          />
        </Field>
        <Field label="Rate, PKR for 1 unit" help="Use the bank's TT rate, or when the automatic update fails." error={invalid ? 'Enter a rate above zero, for example 281.35.' : undefined}>
          <TextField inputMode="decimal" className="num text-right" value={rateText} onChange={e => setRateText(e.target.value)} placeholder="0.00" autoComplete="off" />
        </Field>
        <Field label="As of">
          <DateInput value={asOf} onChange={setAsOf} />
        </Field>
        <div className="flex items-start gap-3 rounded bg-sunken p-3 text-sm text-fg-2">
          <p>Applies for the day you pick (today by default). Tomorrow&apos;s automatic rate replaces it unless you enter another. Anyone on the team can add one.</p>
        </div>
        <Button type="submit" variant="primary" className="justify-self-start" busy={save.isPending} busyLabel="Saving" disabled={rate === null || rate <= 0}>
          Save rate
        </Button>
      </form>
    </Panel>
  )
}
