import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { InfoTip } from '@/ui/InfoTip'
import { businessToday } from '@/lib/dates'
import { mapPgError, type MappedError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/ui/EmptyState'
import { StatusText } from '@/ui/StatusText'
import { Skeleton } from '@/ui/Skeleton'
import { SumBar } from '@/ui/SumBar'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { MonthPager } from '@/features/money/monthEnd/MonthEndFrame'
import { monthKeyLabel, shiftMonth } from '@/features/money/expenses/model'
import { useBankMonth, useTickLine } from '@/features/money/bank/hooks'
import { bankTotals, buildBankView, defaultStatementMonth, isOpenableMonth, type BankLine } from '@/features/money/bank/model'
import { TickPanel } from '@/features/money/bank/TickPanel'

/*
 * Forest: 58-money-checks.html (the statement-month card, the totals card, a card per list).
 * Money › Lock a month › Bank check (M12; admin only; the old "Bank tick", reached from the checklist). Pick the statement month, tick each bank line against the statement:
 * one tap a line, one tap a whole PSID group, the same tap again to undo. The four totals are for comparing with the
 * statement's total credits and debits. Nothing is typed and there is no import. Layout: g2-month-end "Bank tick".
 *
 * The month is in the address (?month=2026-10) so a link from the checklist lands on the right statement.
 */
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

export function BankTickPage() {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const asked = params.get('month')
  const month = isOpenableMonth(asked, today) ? asked : defaultStatementMonth(today)
  const thisMonth = today.slice(0, 7)

  const data = useBankMonth(month)
  const tick = useTickLine(month)
  const view = useMemo(() => (data.data ? buildBankView(data.data, month) : null), [data.data, month])
  const totals = useMemo(() => (view ? bankTotals(view) : null), [view])

  const [error, setError] = useState<MappedError | null>(null)
  const [just, setJust] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => setError(null), [month])

  const onTick = (line: BankLine) => {
    setError(null)
    const next = !line.ticked
    if (next) {
      setJust(line.key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setJust(null), 2400)
    }
    tick.mutate(
      { line, tick: next },
      {
        onError: e => {
          setJust(null)
          setError(mapPgError(e, { entity: 'bank tick' }))
        },
      },
    )
  }

  const go = (by: number) => setParams({ month: shiftMonth(month, by) }, { replace: true })
  // The one definition of "to match", the same number Lock a month's bank check says (bankLinesToMatch).
  const openCount = totals ? totals.openIn.count + totals.openOut.count : undefined
  const allLines = view ? view.in.ticked.length + view.in.open.length + view.in.older.length + view.out.ticked.length + view.out.open.length + view.out.older.length : 0
  const back = `/money/month-end?month=${month}`
  const empty =
    view &&
    view.in.ticked.length +
      view.in.open.length +
      view.in.older.length +
      view.out.ticked.length +
      view.out.open.length +
      view.out.older.length ===
      0

  // 58-money-checks .qb-monthbar: the statement month is its own card under the title, on every width.
  const picker = (
    <div className={cn(CARD, 'flex flex-wrap items-center gap-x-4 gap-y-2 px-card py-3')}>
      <span className="text-base font-bold text-fg-2">Statement month</span>
      <span className="inline-flex items-center gap-2">
        <MonthPager month={month} thisMonth={thisMonth} go={go} label="Statement month" />
        <InfoTip label="About matching the bank statement">
          Tick each line that is on the {monthKeyLabel(month).split(' ')[0]} bank statement. Select a line again to undo. Cash items never appear here.
          An FBR payment is one line per PSID, however many invoices it covers. Compare the matched totals with the statement&apos;s total
          credits and debits. Ticking changes nothing in the books and stays editable after the month is locked.
        </InfoTip>
      </span>
    </div>
  )

  return (
    <MoneyFrame active={null}>
      <MoneySubHeader
        back={{ to: `/money/month-end?month=${month}`, label: 'Lock a month' }}
        title="Bank check"
        meta={totals ? <StateChip open={openCount ?? 0} /> : null}
      />

      {picker}

      {data.isError ? (
        <div className={cn(CARD, 'mx-auto mt-8 w-full max-w-prose p-card')}>
          <EmptyState
            mood="error"
            title="The bank statement lines did not load"
            actions={
              <Button variant="primary" onClick={() => void data.refetch()}>
                Try again
              </Button>
            }
          >
            Payments, expenses and ticks are safe. Nothing was changed. Try again, and if it keeps failing, tell the admin.
          </EmptyState>
        </div>
      ) : data.isPending || !view || !totals ? (
        <Loading />
      ) : (
        <>
          {error ? (
            <Banner tone="danger" title={error.kind === 'closed-month' ? error.message : "The tick was not saved"}>
              {error.kind === 'closed-month'
                ? 'The tick was not saved. Ask an admin to reopen the month, then tick again.'
                : `${error.message} The line is back where it was.`}
            </Banner>
          ) : null}
          {/* 58-money-checks .qb-sumstrip: the three figures as one card of cells, on every width. */}
          <SumBar
            className="rounded-card shadow-e1 max-sm:grid-cols-1"
            label="Running ticked totals"
            items={[
              {
                label: 'Matched, money in',
                amount: totals.tickedIn.amount,
                paisa: 'auto', // matched against the statement to the paisa
                sub: <span className="num">{items(totals.tickedIn.count)}</span>,
              },
              {
                label: 'Matched, money out',
                amount: totals.tickedOut.amount,
                paisa: 'auto', // matched against the statement to the paisa
                sub: <span className="num">{items(totals.tickedOut.count)}</span>,
              },
              {
                label: 'Still to match',
                count: openCount ?? 0,
                sub: (
                  <>
                    <span className="num">{totals.openIn.count}</span> in · <span className="num">{totals.openOut.count}</span> out
                    {totals.openOut.older ? (
                      <>
                        {' '}
                        · <span className="num">{totals.openOut.older}</span> older
                      </>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
          {empty ? (
            <section className={CARD}>
              <EmptyState
                title={`Nothing to tick for ${monthKeyLabel(month)}`}
                actions={
                  <Button variant="primary" onClick={() => navigate(back)}>
                    Back to Lock a month
                  </Button>
                }
              >
                No bank payments, bank expenses or FBR payments fall in this month. Cash items never appear here.
              </EmptyState>
            </section>
          ) : (
            <>
              <div className="grid items-start gap-card-gap xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <TickPanel dir="in" side={view.in} justTicked={just} onTick={onTick} />
                <TickPanel dir="out" side={view.out} justTicked={just} onTick={onTick} />
              </div>
              {/* The page's one green button, always in reach while ticking: how far along, and back to the checklist. */}
              <div
                data-testid="bank-progress"
                className="sticky bottom-3 z-sticky flex flex-wrap items-center gap-3 rounded-card border bg-surface px-card py-3 shadow-pop"
              >
                <span className="text-lg">
                  <b className="num font-semibold">{allLines - (openCount ?? 0)}</b> of <span className="num">{allLines}</span> matched
                </span>
                <span className="flex-1" />
                <Button variant="primary" size="touch" onClick={() => navigate(back)}>
                  Done
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </MoneyFrame>
  )
}

/** The page's state as text, no chip (spec 1.5): "7 to match" (we act) or "Everything matched" (done). */
function StateChip({ open }: { open: number }) {
  return (
    <span data-testid="bank-state">
      {open === 0 ? <StatusText tone="done">Everything matched</StatusText> : <StatusText tone="now">{`${open} to match`}</StatusText>}
    </span>
  )
}

/** Shaped like the page: the three totals in one card, then the two lists as cards of rows (live bug 26: three cells, as loaded). */
function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the bank statement lines" className="grid gap-card-gap">
      <div className={cn(CARD, 'grid grid-cols-1 gap-px overflow-hidden bg-line sm:grid-cols-3')}>
        {[0, 1, 2].map(i => (
          <div key={i} data-testid="bank-skeleton-cell" className="grid gap-2 bg-surface px-card py-4">
            <Skeleton className="h-3 w-[6rem]" />
            <Skeleton className="h-6 w-[8rem]" />
            <Skeleton className="h-3 w-[5rem]" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-card-gap xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {[0, 1].map(i => (
          <div key={i} className={cn(CARD, 'min-w-0 overflow-hidden')}>
            <div className="flex min-h-head items-center gap-3 border-b px-card py-3">
              <Skeleton className="h-5 w-[6rem]" />
              <Skeleton className="h-5 w-[9rem]" />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b px-card py-1">
              <Skeleton className="h-3 w-[8rem]" />
              <Skeleton className="h-3 w-8" />
            </div>
            {[0, 1, 2, 3, 4].map(r => (
              <div key={r} data-testid="bank-skeleton-row" className="grid min-h-row grid-cols-[var(--sp-6)_3.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-card py-2 last:border-b-0">
                <Skeleton className="size-6" />
                <Skeleton className="h-3 w-12" />
                <span className="grid min-w-0 gap-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </span>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
