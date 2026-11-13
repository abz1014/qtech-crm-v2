import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { InfoTip } from '@/ui/InfoTip'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { businessToday } from '@/lib/dates'
import { mapPgError, type MappedError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
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
 * Money › Lock a month › Bank check (M12; admin only; the old "Bank tick", reached from the checklist). Pick the statement month, tick each bank line against the statement:
 * one tap a line, one tap a whole PSID group, the same tap again to undo. The four totals are for comparing with the
 * statement's total credits and debits. Nothing is typed and there is no import. Layout: g2-month-end "Bank tick".
 *
 * The month is in the address (?month=2026-10) so a link from the checklist lands on the right statement.
 */
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

export function BankTickPage() {
  const today = businessToday()
  // Desktop: the statement month sits on the title's line; a phone keeps its own row under the bar.
  const wide = useMediaQuery('(min-width: 768px)')
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

  const picker = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium text-fg-2">Statement month</span>
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
        actions={wide ? picker : undefined}
      />

      {wide ? null : picker}

      {data.isError ? (
        <div className="mx-auto mt-12 max-w-[520px] rounded-panel border bg-surface p-6">
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
          <SumBar
            className="max-sm:grid-cols-1"
            label="Running ticked totals"
            desktop="strip"
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
            <section className="rounded-panel border bg-surface">
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
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <TickPanel dir="in" side={view.in} justTicked={just} onTick={onTick} />
                <TickPanel dir="out" side={view.out} justTicked={just} onTick={onTick} />
              </div>
              {/* The page's one green button, always in reach while ticking: how far along, and back to the checklist. */}
              <div
                data-testid="bank-progress"
                className="sticky bottom-3 z-10 mt-2 flex flex-wrap items-center gap-3 rounded-panel border border-line-strong bg-surface px-5 py-3 shadow-pop"
              >
                <span className="text-base">
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

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the bank statement lines" className="grid gap-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border bg-line md:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="grid gap-2 bg-surface px-5 py-4">
            <Skeleton className="h-3 w-[6rem]" />
            <Skeleton className="h-5 w-[8rem]" />
            <Skeleton className="h-3 w-[10rem]" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {[0, 1].map(i => (
          <div key={i} className="min-w-0 rounded-panel border bg-surface md:rounded-none md:border-0 md:bg-transparent">
            <div className="flex min-h-[52px] items-center border-b py-2 pl-5 pr-4 md:pl-0 md:pr-0">
              <Skeleton className="h-4 w-[7rem]" />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b px-5 py-1 md:px-0">
              <Skeleton className="h-3 w-[8rem]" />
              <Skeleton className="h-3 w-8" />
            </div>
            {[0, 1, 2, 3, 4].map(r => (
              <div key={r} data-testid="bank-skeleton-row" className="grid min-h-[48px] grid-cols-[28px_52px_minmax(0,1fr)_auto] items-center gap-3 border-b px-5 py-[6px] md:px-0">
                <Skeleton className="size-[20px]" />
                <Skeleton className="h-3 w-12" />
                <span className="grid min-w-0 gap-1">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </span>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
