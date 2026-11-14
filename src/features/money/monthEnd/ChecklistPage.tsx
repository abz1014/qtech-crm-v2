import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ChartColumn, ChevronRight, CircleCheck, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeReconciliationExceptions } from '@/lib/reconciliation'
import { Button } from '@/ui/Button'
import { buttonStyles } from '@/ui/buttonStyles'
import { CARD } from '@/ui/card'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { useReconciliationInput } from '@/features/money/hooks'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { CashInHandLine } from '@/features/money/expenses/CashInHand'
import { openFindings, useCheckedSet } from '@/features/money/exceptions/checked'
import { InfoTip } from '@/ui/InfoTip'
import { CloseMonthDialog, ReopenMonthDialog } from '@/features/money/monthEnd/MonthDialogs'
import { lockChecks, lockChecksWithItems } from '@/features/money/monthEnd/lockChecks'
import { MonthPager, MonthStateChip } from '@/features/money/monthEnd/MonthEndFrame'
import { useMonthEnd, type MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import { ReportError } from '@/features/money/monthEnd/ReportParts'
import { closeWindowDay, formatClosedAt, formatClosedDay } from '@/features/money/monthEnd/format'
import { closeButtonLabel, closedThrough, closeNeedsMove, closeTarget, monthName, type CheckCard, type ClosedMonth, type Fact } from '@/features/money/monthEnd/model'

/*
 * Money › Lock a month (M10; admin only). Forest: 57-lock-month.html (the month card, the cash card, the forest hero with its lime
 * button, the card of checks and the locked-months card). Owner decision 2026-10-19: the phone layout everywhere. The month and its Lock button
 * on top; then ONLY the checks that have items, one row each, with what the count is made of and a link to the screen that fixes
 * it (Bank check, Expenses, Margins, Invoices, To collect, Mistakes to fix); the checks that are clear are one
 * line. None blocks the lock: "Lock September" is two taps, the button then the confirmation, and what locking does is one (i)
 * beside the button. The money reports for the month are one link to Reports. Locked months, with Reopen, sit under the list.
 *
 * "Mistakes to fix" (the reconciliation checks, M07) joins the list here: it looks at every month, not only this one, so its row
 * says so.
 */
interface Row {
  key: string
  label: string
  n: number
  parts: Fact[]
  linkLabel: string
  to: string
}

export function ChecklistPage() {
  const ctx = useMonthEnd()
  const [reopen, setReopen] = useState<ClosedMonth | null>(null)
  const isClosed = ctx.state?.kind === 'closed'
  const recon = useReconciliationInput(true)
  const checkedTicks = useCheckedSet()
  const things = useMemo(() => (recon.data ? openFindings(checkedTicks, computeReconciliationExceptions(recon.data)) : null), [recon.data, checkedTicks])

  return (
    <MoneyFrame active="month-end">
      {/* 57-lock-month .qb-monthbar: the month card, its state chip and the one link to the month's reports. */}
      <div className={cn(CARD, 'flex flex-wrap items-center gap-x-4 gap-y-2 px-card py-3')}>
        <MonthPager month={ctx.month} thisMonth={ctx.thisMonth} go={ctx.go} />
        {ctx.state ? <MonthStateChip closed={isClosed} /> : null}
        <span className="flex-1" />
        {/* Bank check is the bank check's own row (and the clear line's link when it has nothing), never twice. */}
        <Link
          to={`/money/reports${ctx.search}`}
          className="inline-flex min-h-touch items-center gap-2 rounded-control text-base font-bold text-primary underline-offset-4 hover:underline"
          data-testid="month-reports-link"
        >
          <Icon icon={ChartColumn} size="sm" />
          Reports for {monthName(ctx.month)}
          <Icon icon={ChevronRight} size="sm" />
        </Link>
      </div>

      {isClosed ? <LockBar month={ctx.month} /> : null}
      {/* 0087 (A9, owner: yes): cash in hand, with Count cash, so a missing small cash expense shows before the month is locked.
          57-lock-month .lm-cash: its own white card, the one Forest card look. */}
      <div className="max-[359px]:[&>section>svg:first-child]:hidden [&>section]:rounded-card [&>section]:px-card [&>section]:py-4 [&>section]:shadow-e1">
        <CashInHandLine />
      </div>

      {ctx.statusError ? (
        <ReportError title="The checklist did not load" onRetry={ctx.refetch} />
      ) : !ctx.statusReady || !ctx.state ? (
        <ChecklistLoading />
      ) : ctx.state.kind === 'not-ended' && ctx.hasMoney === false ? (
        <section className={CARD}>
          <EmptyState
            title={`Nothing to check for ${monthName(ctx.month)} yet`}
            actions={
              <>
                <Link to="/money/receivables" className={buttonStyles({ variant: 'secondary' })}>
                  Record a payment
                </Link>
                <Link to="/money/expenses?burst=1" className={buttonStyles({ variant: 'secondary' })}>
                  Add expenses
                </Link>
              </>
            }
          >
            No payments or expenses are recorded for {monthName(ctx.month)}. The current month cannot be locked. Once it has ended, this page lists its checks and Today shows &ldquo;Lock {monthName(ctx.month)}&rdquo;.
            {ctx.closed.length ? ` ${closedThrough(ctx.closed)} and earlier are locked.` : ''}
          </EmptyState>
        </section>
      ) : (
        // Room under the last card for the phone's sticky action bar.
        <div className="grid gap-4 max-md:pb-[calc(var(--control-lg-h)+2rem)]">
          <Hero ctx={ctx} extra={things?.length ?? 0} />
          <CheckList ctx={ctx} things={things} />
          <ClosedList ctx={ctx} onReopen={setReopen} />
        </div>
      )}
      <ReopenMonthDialog entry={reopen} onClose={() => setReopen(null)} />
    </MoneyFrame>
  )
}

/** 57-lock-month: the locked month's banner (.qb-banner), above the cash card and the hero. */
function LockBar({ month }: { month: string }) {
  const name = monthName(month)
  return (
    <div data-testid="lock-bar" className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card bg-tone-info-bg px-card py-4 text-base text-tone-info-fg">
      <Icon icon={Lock} className="mt-1 shrink-0" />
      <p className="min-w-0 flex-[1_1_20rem] text-fg">
        <b className="font-bold">{monthKeyLabel(month)} is locked.</b> Payments, expenses and invoices dated in {name} are frozen.{' '}
        <span className="text-fg-2">Bank matching and the sent-to-customer and FBR dates stay open.</span>
      </p>
    </div>
  )
}

/**
 * The month, how many checks have items, and the one action: 57-lock-month .lm-hero, the page's forest card with its lime button
 * (data-surface re-inks the words, as on the Money hub). On a phone the button is the green one in the StickyActionBar.
 */
function Hero({ ctx, extra }: { ctx: MonthEndCtx; extra: number }) {
  const [open, setOpen] = useState(false)
  const state = ctx.state
  const closed = state?.kind === 'closed'
  const withItems = lockChecksWithItems(lockChecks(ctx.cards, extra))
  const day = closeWindowDay(ctx.month, ctx.today)
  const name = monthName(ctx.month)
  const target = closeTarget(ctx.month, state)
  // A month is locked only while it is on screen: when an older month comes first, the button takes you there and locks nothing.
  const move = closeNeedsMove(ctx.month, state)
  const phone = useMediaQuery('(max-width: 767px)')
  // The sticky bar replaces the bottom tabs on a phone (StickyActionBar's contract); the bar's back arrow leads out.
  useMobileBar({ title: 'Lock a month', back: 'history', fallback: '/money/receivables', hideTabs: true })
  const navigate = useNavigate()
  // A closed month's next step is reading its reports (reopening is in the list below), so that is the one button.
  // On the forest card it is lime (the hero's one action); on the phone's white bar it is the green primary.
  const button = (size: 'lg' | 'touch', variant: 'lime' | 'primary') =>
    closed ? (
      <Button size={size} variant={variant} icon={ChartColumn} onClick={() => navigate(`/money/reports${ctx.search}`)}>
        Reports for {name}
      </Button>
    ) : (
      <Button
        size={size}
        variant={variant}
        icon={move ? ArrowRight : Lock}
        disabled={state?.kind === 'not-ended'}
        onClick={() => (move ? ctx.setMonth(target) : setOpen(true))}
      >
        {state ? closeButtonLabel(ctx.month, state) : `Lock ${name}`}
      </Button>
    )
  const tip = (
    <InfoTip label="About locking a month" align="end">
      {state?.kind === 'not-ended' ? <>{name} can be locked once it has ended. </> : null}
      Locking freezes payments, expenses and invoices dated in {name}. Bank matching and the sent-to-customer and FBR dates stay open. It can be reopened at any time. Both actions are written to the audit log. Months lock one at a time, oldest first, and only while they are on screen.
    </InfoTip>
  )
  return (
    <>
      <section
        data-surface="navy"
        aria-label={`${monthKeyLabel(ctx.month)} summary`}
        className="grid gap-4 rounded-card bg-hero p-card text-fg shadow-e2"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="grid min-w-0 flex-[1_1_14rem] gap-1">
            <p className="text-sm font-card text-fg-2">Lock a month</p>
            {/* No chip in the heading (spec 1.2): the month's state is the chip on the month card and the lock banner. */}
            <h2 className="text-2xl font-heavy tracking-tight text-balance">{monthKeyLabel(ctx.month)}</h2>
          </div>
          {phone ? null : (
            <div className="flex items-center gap-2">
              {button('lg', 'lime')}
              {closed ? null : tip}
            </div>
          )}
        </div>
        <p className="text-lg" data-testid="checks-summary">
          {withItems === 0 ? (
            'Every check is clear.'
          ) : (
            <>
              <b className="num font-heavy text-lime-300">{withItems}</b> {withItems === 1 ? 'check has' : 'checks have'} something to look at. None of them stops the lock.
            </>
          )}
        </p>
        {/* Only a fact that matters: when it was locked, or how far into the 10-day lock window we are. No bare date. */}
        {(state?.kind === 'open' && target !== ctx.month) || (closed && ctx.closedEntry) || day ? (
          <div className="grid gap-1 text-sm text-fg-2">
            {state?.kind === 'open' && target !== ctx.month ? (
              // One month at a time (owner decision 2026-10-22): an older open month is locked first, and the button names it.
              <span data-testid="close-order">
                {monthKeyLabel(target)} is still open and has to be locked before {name}.
              </span>
            ) : null}
            {closed && ctx.closedEntry ? (
              <span>
                Locked {formatClosedAt(ctx.closedEntry.closedAt)}
                {phone ? null : <> &middot; Reopen it from the list below.</>}
              </span>
            ) : day ? (
              <span>Day {day} of the 10-day lock window</span>
            ) : null}
          </div>
        ) : null}
        {closed || move ? null : <CloseMonthDialog open={open} onOpenChange={setOpen} ctx={ctx} mistakes={extra} />}
      </section>
      {phone ? (
        // The phone's one action bar (spec 5.3), the same action as on desktop.
        <StickyActionBar label="Lock a month actions" primary={button('touch', 'primary')} secondary={closed ? undefined : tip} />
      ) : null}
    </>
  )
}

/**
 * Only the checks that have items, one row each with its fix; the clear ones on one line at the foot of the same card
 * (57-lock-month .lm-checkcard: a warning bar, the label and its count, what the count is made of, and where it is fixed).
 */
function CheckList({ ctx, things }: { ctx: MonthEndCtx; things: ReturnType<typeof computeReconciliationExceptions> | null }) {
  const rows: Row[] = ctx.cards.filter(c => !c.clear).map(fromCard)
  const clear: string[] = ctx.cards.filter(c => c.clear).map(c => c.label)
  // Still reachable when nothing is left to match (comparing totals, unticking a mistake): one link, on the clear line.
  const bankClear = ctx.cards.some(c => c.key === 'bank_unticked' && c.clear)
  if (things && things.length > 0) {
    const critical = things.filter(t => t.severity === 'critical').length
    rows.push({
      key: 'things_to_check',
      label: 'Mistakes to fix',
      n: things.length,
      parts: [`Orders, payments, invoices or costs that do not add up, in any month.${critical ? ` ${critical} ${critical === 1 ? 'is' : 'are'} serious.` : ''}`],
      linkLabel: 'Open mistakes to fix',
      to: '/money/exceptions',
    })
  } else if (things) clear.push('Mistakes to fix')
  return (
    <section aria-label="Checklist" className={cn(CARD, 'overflow-hidden')}>
      {rows.length > 0 ? (
        <ul>
          {rows.map(r => (
            <li key={r.key} data-testid={`check-${r.key}`} className="border-t first:border-t-0">
              <Link
                to={r.to}
                className="group grid min-h-row-tall grid-cols-[var(--sp-1)_minmax(0,1fr)_auto] items-stretch gap-x-4 pr-card transition-colors duration-fast ease-out hover:bg-sunken focus-visible:bg-sunken md:grid-cols-[var(--sp-1)_minmax(0,1fr)_auto_auto]"
              >
                <i aria-hidden="true" className="bg-tone-warning-fg" />
                <span className="grid min-w-0 content-center gap-1 py-4">
                  {/* The count rides on the label's last word, so a wrapped label never leaves it alone on a line. */}
                  <span className="text-base font-bold [overflow-wrap:anywhere]">
                    {r.label}{' '}
                    <span className="num ml-1 inline-grid min-w-chip place-items-center whitespace-nowrap rounded-pill bg-tone-warning-bg px-2 align-[0.0625rem] text-sm font-heavy text-tone-warning-fg">{r.n}</span>
                  </span>
                  <span className="text-pretty text-sm text-fg-2">
                    {r.parts.map((p, i) =>
                      typeof p === 'string' ? (
                        <Fragment key={i}>{p}</Fragment>
                      ) : (
                        <span key={i} className="num">
                          {p.mono}
                        </span>
                      ),
                    )}
                  </span>
                </span>
                <span className="hidden self-center text-sm font-bold text-primary group-hover:underline md:inline">{r.linkLabel}</span>
                <Icon icon={ChevronRight} size="sm" className="self-center text-fg-muted transition-transform duration-fast ease-out group-hover:translate-x-1 motion-reduce:transition-none" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {clear.length > 0 ? (
        <p data-testid="checks-clear" className={cn('flex items-start gap-3 px-card py-4 text-sm text-fg-2', rows.length > 0 && 'border-t bg-canvas')}>
          <Icon icon={CircleCheck} className="mt-px shrink-0 text-tone-success-fg" />
          <span>
            <b className="font-bold text-fg">
              {clear.length} {clear.length === 1 ? 'check is' : 'checks are'} clear:
            </b>{' '}
            {clear.join(', ')}.
            {bankClear ? (
              <>
                {' '}
                <Link to={`/money/month-end/bank${ctx.search}`} data-testid="month-bank-link" className="font-bold text-primary underline-offset-4 hover:underline">
                  Bank check
                </Link>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
    </section>
  )
}

const fromCard = (c: CheckCard): Row => ({ key: c.key, label: c.label, n: c.n, parts: c.parts, linkLabel: c.linkLabel, to: c.to })

export function ClosedList({ ctx, onReopen }: { ctx: MonthEndCtx; onReopen: (c: ClosedMonth) => void }) {
  const [all, setAll] = useState(false)
  const through = closedThrough(ctx.closed)
  const shown = all ? ctx.closed : ctx.closed.slice(0, 4)
  // Owner decision 2026-10-22 (0080): months reopen newest first. Only the latest closed month has Reopen; the others say which
  // month to reopen before them, so nobody meets the database's refusal.
  const latest = ctx.closed.reduce<string | null>((m, c) => (m === null || c.key > m ? c.key : m), null)
  return (
    <section aria-labelledby="locked-months-h" className={cn(CARD, 'overflow-hidden')}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-card py-4">
        <h2 id="locked-months-h" className="min-w-0 text-lg font-heavy">
          Locked months
        </h2>
        {through ? <span className="text-sm text-fg-2">Locked through {through}</span> : null}
      </header>
      {/* Locked months only (an open month here contradicted the title); the month on screen says Open or Locked above. */}
      <ul aria-label="Locked months">
        {shown.map(c => (
          <li
            key={c.key}
            data-testid={`closed-${c.key}`}
            className={cn('grid min-h-row grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t px-card py-3 first:border-t-0', c.key === ctx.month && 'bg-brand-100')}
          >
            <Icon icon={Lock} className="text-fg-muted" />
            <span className="grid min-w-0 [overflow-wrap:anywhere]">
              <span className="text-base font-bold">{monthKeyLabel(c.key)}</span>
              <span className="text-sm text-fg-2">
                Locked {formatClosedDay(c.closedAt, ctx.today)}
                {c.closedBy ? ` by ${c.closedBy}` : ''}
                {c.note ? ` · ${c.note}` : ''}
              </span>
            </span>
            {c.key === latest ? (
              <Button onClick={() => onReopen(c)} aria-label={`Reopen ${monthKeyLabel(c.key)}`} className="max-md:h-touch">
                Reopen
              </Button>
            ) : (
              <span className="max-w-[16ch] text-right text-sm text-fg-2" data-testid={`reopen-order-${c.key}`}>
                Reopen {latest ? monthKeyLabel(latest) : 'the later months'} first
              </span>
            )}
          </li>
        ))}
        {ctx.closed.length === 0 ? <li className="px-card py-4 text-base text-fg-2">None locked yet.</li> : null}
      </ul>
      {ctx.closed.length > 4 ? (
        <div className="border-t px-card py-2">
          <Button variant="quiet" onClick={() => setAll(a => !a)} className="max-md:h-touch">
            {all ? 'Show fewer' : `Show all ${ctx.closed.length} locked months`}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/** Shaped like the page: the forest hero, the card of check rows and the locked-months card. */
function ChecklistLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the month-end checklist" className="grid gap-4">
      <div data-surface="navy" className="grid gap-4 rounded-card bg-hero p-card shadow-e2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-[7rem]" />
            <Skeleton className="h-8 w-[12rem]" />
          </div>
          <Skeleton className="h-control-lg w-[10rem] max-md:hidden" />
        </div>
        <Skeleton className="h-5 w-full max-w-[28rem]" />
      </div>
      <div className={cn(CARD, 'overflow-hidden')}>
        {[0, 1, 2].map(i => (
          <div key={i} className="grid min-h-row-tall content-center gap-2 border-t px-card py-4 first:border-t-0">
            <Skeleton className="h-4 w-[14rem] max-w-full" />
            <Skeleton className="h-3 w-full max-w-[30rem]" />
          </div>
        ))}
      </div>
      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="border-b px-card py-4">
          <Skeleton className="h-5 w-[9rem]" />
        </div>
        <div className="flex min-h-row items-center gap-3 px-card py-3">
          <Skeleton className="size-5" />
          <span className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-[8rem]" />
            <Skeleton className="h-3 w-[12rem] max-w-full" />
          </span>
          <Skeleton className="h-control w-[5rem]" />
        </div>
      </div>
    </div>
  )
}
