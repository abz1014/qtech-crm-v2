import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Pencil, RefreshCw } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDateText } from '@/lib/dateInput'
import { storedRate } from '@/lib/formRules'
import { formatRate } from '@/lib/money'
import { parseAmount } from '@/lib/number'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
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
import { SectionSkeleton } from '@/features/settings/settingsParts'
import { useToast } from '@/ui/useToast'
import { Panel } from '@/features/companies/CompanyParts'
import { useFxLatest } from '@/features/rfqs/hooks'
import { useFxHistory, useFxLastAutoRun, useSetFxRate } from '@/features/fx/hooks'
import { ratesStatusLine } from '@/features/settings/ratesModel'
import { autoRunStamp, buildRateRows, manualRateProblem, rateDay, sourceText, unusableWarning, type RateRow } from '@/features/fx/ratesModel'
import { RATE_TABLE_LABEL, RateTable } from '@/features/fx/RateTable'

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
    <div className="grid min-w-0 content-start gap-card-gap">
      <PageHeader
        title="Exchange rates"
        lede={
          <>
            {latest.data ? `${ratesStatusLine(latest.data)} ` : null}
            <InfoTip label="About rates">
              Any team member can enter a rate manually, for example the bank&apos;s TT rate. A manual rate wins for its own day.
              The next automatic rate replaces it unless another is entered. Rates are used only to compare supplier prices in PKR,
              never for invoices.
            </InfoTip>
          </>
        }
      />

      {latest.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading the exchange rates" className="grid gap-card-gap">
          <SectionSkeleton rows={4} />
          <SectionSkeleton rows={3} />
        </div>
      ) : latest.isError ? (
        <EmptyState
          mood="error" bordered
          title="Could not load the exchange rates"
          actions={
            <Button onClick={() => void latest.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-card-gap 2xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="grid min-w-0 gap-card-gap">
            <Panel
              title={RATE_TABLE_LABEL}
              meta="PKR for 1 unit"
              card
              actions={lastRun.data ? <span className="text-base text-fg-muted" data-fx-auto-run>{autoRunStamp(lastRun.data)}</span> : undefined}
            >
              <div data-work="" className="min-w-0 border-t"><RateTable rows={rows} onAdd={addRate} onHistory={setHistoryOf} className="rounded-none border-0 shadow-none" /></div>
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

function HistoryDialog({ currency, onClose }: { currency: string | null; onClose: () => void }) {
  const history = useFxHistory(currency ?? undefined)
  return (
    <Dialog open={currency !== null} onOpenChange={o => (!o ? onClose() : undefined)}>
      {currency ? (
        <DialogContent title={`Recent ${currency} rates`} icon={History} footer={<Button data-cancel onClick={onClose}>Close</Button>}>
          {history.isPending ? (
            <Skeleton className="h-[6rem]" />
          ) : history.isError ? (
            <p className="text-base text-fg-muted">The history did not load. Try again in a moment.</p>
          ) : history.data.length === 0 ? (
            <p className="text-base text-fg-muted">{`No ${currency} rate has been recorded yet.`}</p>
          ) : (
            <ul>
              {history.data.map(h => (
                <li key={`${h.asOf}-${h.source}`} className="flex items-center gap-4 border-t py-3 text-base first:border-t-0">
                  <span className="num min-w-[4.5rem] shrink-0">{rateDay(h.asOf)}</span>
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

  // 0114: the server found the rate more than 20 percent from the latest: the person confirms it or changes it
  const [far, setFar] = useState<string | null>(null)
  const submit = async (confirm = false) => {
    if (rate === null || blocked) return
    try {
      await save.mutateAsync({ currency, ratePkr: rate, asOf: asOf || undefined, confirm })
      setFar(null)
      // The rate as numeric(14,6) keeps it, and the date with its year (hunt HE-9, HE-10).
      toast({ title: 'Rate saved', body: `${currency} ${storedRate(rate)} for ${formatDateText(asOf || businessToday())}`, tone: 'success' })
      setRateText('')
    } catch (err) {
      const m = mapPgError(err, { entity: 'rate' })
      if (m.hint === 'fx_rate_far') {
        setFar(m.message)
        return
      }
      toast({ title: 'Could not save the rate', body: m.message, tone: 'danger' })
    }
  }

  return (
    <div ref={panelRef} className="scroll-mt-[5rem]">
      <Panel card title="Add a rate manually">
        <form
          className="grid gap-4 px-5 pb-5 pt-1 sm:max-w-md"
          onSubmit={e => {
            e.preventDefault()
            void submit(false)
          }}
        >
          <Field label="Currency" help={lastAuto ? `Last automatic: ${formatRate(lastAuto.ratePkr)} on ${rateDay(lastAuto.asOf)}` : undefined}>
            <Select value={currency} onChange={e => onCurrency(e.target.value)} options={rows.map(r => ({ value: r.currency, label: r.currency }))} />
          </Field>
          <Field
            label="Rate, PKR for 1 unit"
            help={check.warning ?? "For example the bank's TT rate."}
            error={check.field === 'rate' ? (check.error ?? undefined) : undefined}
          >
            <TextField ref={rateRef} inputMode="decimal" className="num text-right" value={rateText} onChange={e => { setRateText(e.target.value); setFar(null) }} placeholder="0.00" autoComplete="off" />
          </Field>
          {far ? (
            <div data-testid="fx-rate-far"><Banner tone="warning" title={far}>
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => void submit(true)} busy={save.isPending} busyLabel="Saving">
                  Use this rate
                </Button>
                <Button size="sm" onClick={() => { setFar(null); rateRef.current?.focus() }}>
                  Change it
                </Button>
              </span>
            </Banner></div>
          ) : null}
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
