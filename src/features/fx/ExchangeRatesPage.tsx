import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Pencil, Plus, RefreshCw } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/formatDay'
import { formatDateText } from '@/lib/dateInput'
import { storedRate } from '@/lib/formRules'
import { formatRate } from '@/lib/money'
import { parseAmount } from '@/lib/number'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog, DialogContent } from '@/ui/Dialog'
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
import { ratesStatusLine } from '@/features/settings/ratesModel'
import { ageText, autoRunStamp, bandDetail, buildRateRows, manualRateProblem, rateCardLine, sourceText, unusableWarning, type RateRow } from '@/features/fx/ratesModel'

/*
 * Settings > Exchange rates (R15). Open to the whole team: any staff member may enter today's rate by hand (fx_rates RLS allows
 * it for source = manual), and a manual rate wins over the automatic one for its own day. The bands are the ones the price
 * comparison uses, so a stale rate looks stale everywhere: fresh up to 7 days, stale 8 to 30, unusable over 30 (not compared).
 *
 * FE-2 entry burden: required = currency and rate. Pre-filled = the currency (the row's "Add rate", else the one most in need),
 * the date (today).
 * Audit 2026-10-22: who can enter a rate is said once, in the (i); the lede says what actually happened (ratesStatusLine).
 * Every row has "Add rate" (fills the form's currency and puts the cursor in the rate) and "History" (the recent rates of that
 * currency in a dialog, instead of a second panel that repeated the table). Below 640 px the rows are cards, not a cut-off table.
 */

export function ExchangeRatesPage() {
  const latest = useFxLatest()
  const rows = useMemo(() => buildRateRows(latest.data ?? []), [latest.data])
  const lastRun = useFxLastAutoRun()
  const [picked, setPicked] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  // The currency the form shows: the one chosen, else the first that needs a rate, else the first.
  const current = picked ?? rows.find(r => r.staleness !== 'fresh')?.currency ?? rows[0]?.currency ?? 'USD'
  const warnings = rows.map(unusableWarning).filter((w): w is string => w !== null)
  const addRate = (c: string) => {
    setPicked(c)
    setFocusTick(t => t + 1)
  }

  return (
    <div className="grid min-w-0 content-start gap-4">
      <PageHeader
        title="Exchange rates"
        lede={
          <>
            {latest.data ? `${ratesStatusLine(latest.data)} ` : null}
            <InfoTip label="About rates">
              Anyone on the team can enter a rate by hand, for example the bank&apos;s TT rate. A rate entered by hand wins for its own
              day; the next automatic rate replaces it unless you enter another. Rates are used only to compare supplier prices in PKR,
              never for invoices.
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
              title="Latest rate per currency"
              meta="PKR for 1 unit"
              className="overflow-clip"
              actions={lastRun.data ? <span className="text-sm text-fg-muted" data-fx-auto-run>{autoRunStamp(lastRun.data)}</span> : undefined}
            >
              <RatesTable rows={rows} onAdd={addRate} onHistory={setHistoryOf} />
            </Panel>
            {warnings.map(w => (
              <Banner key={w} tone="warning" title={w.split('. ')[0] + '.'}>
                {w.split('. ').slice(1).join('. ')}
              </Banner>
            ))}
          </div>
          <AddRateCard rows={rows} currency={current} onCurrency={setPicked} focusTick={focusTick} />
        </div>
      )}
      <HistoryDialog currency={historyOf} onClose={() => setHistoryOf(null)} />
    </div>
  )
}

const shortDay = (iso: string) => formatDay(iso).replace(/^\w+ /, '')

function RowActions({ r, onAdd, onHistory, touch }: { r: RateRow; onAdd: (c: string) => void; onHistory: (c: string) => void; touch?: boolean }) {
  const size = touch ? 'touch' : 'sm'
  // In the table the two actions are icon buttons (a name and a tooltip each) so the Actions column stays narrow; on a phone they are words.
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', touch ? '-ml-3 justify-start' : 'justify-end')}>
      {touch ? (
        <>
          <Button size={size} variant="quiet" icon={Plus} onClick={() => onAdd(r.currency)} aria-label={`Add rate for ${r.currency}`}>
            Add rate
          </Button>
          <Button size={size} variant="quiet" icon={History} onClick={() => onHistory(r.currency)} aria-label={`History of ${r.currency}`}>
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
      <span className="text-sm text-fg-muted">{bandDetail(r.ageDays)}</span>
    </span>
  )
}

function RatesTable({ rows, onAdd, onHistory }: { rows: RateRow[]; onAdd: (c: string) => void; onHistory: (c: string) => void }) {
  const columns: Column<RateRow>[] = [
    {
      id: 'currency',
      header: 'Currency',
      value: r => r.currency,
      cell: r => (
        <span className="grid">
          <span className="font-medium">{r.currency}</span>
          <span className="text-sm text-fg-muted">{r.name}</span>
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
            <span className="num">{shortDay(r.asOf)}</span>
            {r.source ? (
              <span className="inline-flex items-center gap-1 text-sm text-fg-muted">
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
    {
      id: 'action',
      header: 'Actions', // read by assistive tech only; the header text is hidden by the table's className below
      align: 'right',
      cell: r => <RowActions r={r} onAdd={onAdd} onHistory={onHistory} />,
    },
  ]
  return (
    <DataTable
      label="Latest exchange rate per currency"
      columns={columns}
      rows={rows}
      getRowId={r => r.currency}
      twoLine
      className="rounded-none border-0 [&_thead_th:last-child]:text-transparent"
      mobileRow={r => (
        <span className="grid gap-2">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 text-base font-medium" data-rate-card={r.currency}>
              {rateCardLine(r)}
            </span>
            <AgeCell r={r} />
          </span>
          <RowActions r={r} onAdd={onAdd} onHistory={onHistory} touch />
        </span>
      )}
    />
  )
}

function HistoryDialog({ currency, onClose }: { currency: string | null; onClose: () => void }) {
  const history = useFxHistory(currency ?? undefined)
  return (
    <Dialog open={currency !== null} onOpenChange={o => (!o ? onClose() : undefined)}>
      {currency ? (
        <DialogContent title={`Recent ${currency} rates`} icon={History} footer={<Button data-cancel onClick={onClose}>Close</Button>}>
          {history.isPending ? (
            <Skeleton className="h-24" />
          ) : history.isError ? (
            <p className="text-sm text-fg-muted">The history did not load. Try again in a moment.</p>
          ) : history.data.length === 0 ? (
            <p className="text-sm text-fg-muted">{`No ${currency} rate has been recorded yet.`}</p>
          ) : (
            <ul>
              {history.data.map(h => (
                <li key={`${h.asOf}-${h.source}`} className="flex items-center gap-4 border-t py-3 text-sm first:border-t-0">
                  <span className="num w-[72px] shrink-0">{shortDay(h.asOf)}</span>
                  <span className="inline-flex items-center gap-1 text-fg-2">
                    <Icon icon={h.source === 'manual' ? Pencil : RefreshCw} size="sm" className="text-fg-muted" />
                    {sourceText(h.source)}
                  </span>
                  <span className="num ml-auto">{formatRate(h.ratePkr)}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function AddRateCard({ rows, currency, onCurrency, focusTick }: { rows: RateRow[]; currency: string; onCurrency: (c: string) => void; focusTick: number }) {
  const { toast } = useToast()
  const save = useSetFxRate()
  const [rateText, setRateText] = useState('')
  const [asOf, setAsOf] = useState(businessToday())
  const history = useFxHistory(currency)
  const lastAuto = history.data?.find(h => h.source === 'auto')
  const rate = parseAmount(rateText)
  const last = rows.find(r => r.currency === currency)?.ratePkr ?? null
  const check = manualRateProblem({ text: rateText, rate, asOf, today: businessToday(), last })
  const blocked = rate === null || check.error !== null
  const rateRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // A row's "Add rate": the currency is already set; bring the form into view with the cursor in the rate.
  useEffect(() => {
    if (focusTick === 0) return
    panelRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    rateRef.current?.focus({ preventScroll: true })
  }, [focusTick])

  const submit = async () => {
    if (rate === null || blocked) return
    try {
      await save.mutateAsync({ currency, ratePkr: rate, asOf: asOf || undefined })
      // The rate as numeric(14,6) keeps it, and the date with its year (hunt HE-9, HE-10).
      toast({ title: 'Rate saved', body: `${currency} ${storedRate(rate)} for ${formatDateText(asOf || businessToday())}`, tone: 'success' })
      setRateText('')
    } catch (err) {
      toast({ title: 'Could not save the rate', body: mapPgError(err, { entity: 'rate' }).message, tone: 'danger' })
    }
  }

  return (
    <div ref={panelRef} className="scroll-mt-20">
      <Panel title="Add a rate by hand">
        <form
          className="grid gap-4 px-5 py-4"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label="Currency" help={lastAuto ? `Last automatic: ${formatRate(lastAuto.ratePkr)} on ${shortDay(lastAuto.asOf)}` : undefined}>
            <Select value={currency} onChange={e => onCurrency(e.target.value)} options={rows.map(r => ({ value: r.currency, label: r.currency }))} />
          </Field>
          <Field
            label="Rate, PKR for 1 unit"
            help={check.warning ?? "For example the bank's TT rate."}
            error={check.field === 'rate' ? (check.error ?? undefined) : undefined}
          >
            <TextField ref={rateRef} inputMode="decimal" className="num text-right" value={rateText} onChange={e => setRateText(e.target.value)} placeholder="0.00" autoComplete="off" />
          </Field>
          <Field label="As of" error={check.field === 'asOf' ? (check.error ?? undefined) : undefined}>
            <DateInput value={asOf} onChange={setAsOf} />
          </Field>
          <Button type="submit" variant="primary" className="justify-self-start" busy={save.isPending}
            busyLabel="Saving"
            // the screen's one green button stays green; until a rate is typed it is aria-disabled and does nothing
            aria-disabled={blocked || undefined}
            onClick={e => {
              if (blocked) e.preventDefault()
            }}
          >
            Save rate
          </Button>
        </form>
      </Panel>
    </div>
  )
}
