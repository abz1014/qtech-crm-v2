import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CheckCheck, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { mapPgError, type MappedError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { SumBar } from '@/ui/SumBar'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { MonthEndNav } from '@/features/money/monthEnd/MonthEndNav'
import { useMonthEndStatus } from '@/features/money/monthEnd/hooks'
import { buildChecklist, checksWithItems } from '@/features/money/monthEnd/model'
import { monthKeyLabel, monthKeyShort, shiftMonth } from '@/features/money/expenses/model'
import { useBankMonth, useTickLine } from '@/features/money/bank/hooks'
import { bankTotals, buildBankView, defaultStatementMonth, isMonthKey, type BankLine } from '@/features/money/bank/model'
import { TickPanel } from '@/features/money/bank/TickPanel'

/*
 * Money › Month-end › Bank tick (M12; admin only). Pick the statement month, tick each bank line against the statement:
 * one tap a line, one tap a whole PSID group, the same tap again to undo. The four totals are for comparing with the
 * statement's total credits and debits. Nothing is typed and there is no import. Layout: g2-month-end "Bank tick".
 *
 * The month is in the address (?month=2026-10) so a link from the checklist lands on the right statement.
 */
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

export function BankTickPage() {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const month = isMonthKey(asked) ? asked : defaultStatementMonth(today)
  const thisMonth = today.slice(0, 7)

  const data = useBankMonth(month)
  const tick = useTickLine(month)
  const status = useMonthEndStatus(month)
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
  const openCount = totals ? totals.openIn.count + totals.openOut.count : undefined
  const empty =
    view &&
    view.in.ticked.length +
      view.in.open.length +
      view.in.older.length +
      view.out.ticked.length +
      view.out.open.length +
      view.out.older.length ===
      0

  return (
    <MoneyFrame active="month-end">
      <MonthEndNav
        active="bank"
        counts={{ bank: openCount || undefined, checklist: status.data ? checksWithItems(buildChecklist(status.data, month)) : undefined }}
        search={`?month=${month}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-fg-2">Statement month</span>
        <div role="group" aria-label="Statement month" className="inline-flex gap-[2px] rounded bg-selected p-[2px]">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => go(-1)}
            className="inline-flex h-[26px] items-center rounded px-2 text-fg-muted transition-colors duration-fast hover:text-fg"
          >
            <Icon icon={ChevronLeft} size="sm" />
          </button>
          <span
            aria-live="polite"
            title={monthKeyLabel(month)}
            className="num inline-flex h-[26px] items-center rounded border border-line-strong bg-surface px-3 text-xs font-medium"
          >
            {monthKeyShort(month)}
          </span>
          <button
            type="button"
            aria-label="Next month"
            disabled={month >= thisMonth}
            onClick={() => go(1)}
            className="inline-flex h-[26px] items-center rounded px-2 text-fg-muted transition-colors duration-fast hover:text-fg disabled:text-fg-disabled disabled:hover:text-fg-disabled"
          >
            <Icon icon={ChevronRight} size="sm" />
          </button>
        </div>
        <span className="text-xs text-fg-muted">Tick each line against the bank statement. Cash items never appear here.</span>
        <span className="flex-1" />
        {totals ? <StateChip open={openCount ?? 0} /> : null}
      </div>

      {data.isError ? (
        <div className="mx-auto mt-12 max-w-[520px] rounded border bg-surface p-6">
          <EmptyState
            mood="error"
            title="The bank tick did not load"
            actions={
              <Button variant="primary" onClick={() => void data.refetch()}>
                Try again
              </Button>
            }
          >
            Your payments, expenses and ticks are safe; nothing was changed. Try again, and if it keeps failing, tell the admin.
          </EmptyState>
        </div>
      ) : data.isPending || !view || !totals ? (
        <Loading />
      ) : (
        <>
          {error ? (
            <Banner tone="danger" title={error.kind === 'closed-month' ? error.message : "Couldn't save that tick"}>
              {error.kind === 'closed-month'
                ? 'The tick was not saved. Ask an admin to reopen the month, then tick again.'
                : `${error.message} The line is back where it was.`}
            </Banner>
          ) : null}
          <SumBar
            label="Running ticked totals"
            items={[
              {
                label: 'Ticked, money in',
                amount: totals.tickedIn.amount,
                paisa: 'auto',
                sub: (
                  <>
                    <span className="num">{items(totals.tickedIn.count)}</span>. Compare with the statement&rsquo;s total credits.
                  </>
                ),
              },
              {
                label: 'Ticked, money out',
                amount: totals.tickedOut.amount,
                paisa: 'auto',
                sub: (
                  <>
                    <span className="num">{items(totals.tickedOut.count)}</span>. Compare with the statement&rsquo;s total debits.
                  </>
                ),
              },
              {
                label: 'Not ticked, in',
                amount: totals.openIn.amount,
                paisa: 'auto',
                sub: <span className="num">{items(totals.openIn.count)}</span>,
              },
              {
                label: 'Not ticked, out',
                amount: totals.openOut.amount,
                paisa: 'auto',
                sub: (
                  <>
                    <span className="num">{items(totals.openOut.count)}</span>, <span className="num">{totals.openOut.older}</span> older
                  </>
                ),
              },
            ]}
          />
          {empty ? (
            <section className="rounded border bg-surface">
              <EmptyState title={`Nothing to tick for ${monthKeyLabel(month)}`}>
                No bank payments, bank expenses or FBR deposits fall in this month. Cash items never appear here.
              </EmptyState>
            </section>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <TickPanel dir="in" side={view.in} justTicked={just} onTick={onTick} />
              <TickPanel dir="out" side={view.out} justTicked={just} onTick={onTick} />
            </div>
          )}
          <p className="max-w-[100ch] text-xs text-fg-muted">
            Ticking records that the line appeared on the {monthKeyLabel(month).split(' ')[0]} statement. It changes nothing in the books
            and stays editable after the month closes. Money out lists bank expenses plus FBR deposits, one row per PSID group.
          </p>
        </>
      )}
    </MoneyFrame>
  )
}

function StateChip({ open }: { open: number }) {
  const clear = open === 0
  return (
    <span
      data-testid="bank-state"
      className={cn(
        'inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded border pl-[6px] pr-2 text-xs font-medium leading-none',
        clear
          ? 'border-tone-success-fg/25 bg-tone-success-bg text-tone-success-fg'
          : 'border-tone-warning-fg/25 bg-tone-warning-bg text-tone-warning-fg',
      )}
    >
      <Icon icon={clear ? CheckCheck : TriangleAlert} size="chip" />
      {clear ? (
        'Everything ticked'
      ) : (
        <>
          <span className="num">{open}</span> not ticked
        </>
      )}
    </span>
  )
}

function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the bank tick" className="grid gap-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border bg-line md:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="grid gap-2 bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {[0, 1].map(i => (
          <div key={i} className="rounded border bg-surface">
            <div className="flex min-h-[52px] items-center border-b px-5">
              <Skeleton className="h-4 w-28" />
            </div>
            {[0, 1, 2, 3, 4].map(r => (
              <div key={r} className="flex min-h-[48px] items-center gap-3 border-b px-5">
                <Skeleton className="size-[20px]" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
