import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChartColumn, ChevronRight, CircleCheck, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeReconciliationExceptions } from '@/lib/reconciliation'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { useReconciliationInput } from '@/features/money/hooks'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { useSession } from '@/app/session'
import { openFindings } from '@/features/money/exceptions/checked'
import { InfoTip } from '@/ui/InfoTip'
import { CloseMonthDialog, ReopenMonthDialog } from '@/features/money/monthEnd/MonthDialogs'
import { MonthPager, MonthStateChip } from '@/features/money/monthEnd/MonthEndFrame'
import { useMonthEnd, type MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import { ReportError, Panel } from '@/features/money/monthEnd/ReportParts'
import { closeWindowDay, formatClosedAt, formatClosedDay } from '@/features/money/monthEnd/format'
import { closeButtonLabel, closedThrough, monthName, type CheckCard, type ClosedMonth, type Fact } from '@/features/money/monthEnd/model'

/*
 * Money › Month end (M10; admin only). Owner decision 2026-10-19: the phone layout everywhere. The month and its Close button
 * on top; then ONLY the checks that have items, one row each, with what the count is made of and a link to the screen that fixes
 * it (Match bank statement, Expenses, Margins, Invoices & GST, Who owes us, Things to check); the checks that are clear are one
 * line. None blocks the close: "Close September" is two taps, the button then the confirmation, and what closing does is one (i)
 * beside the button. The money reports for the month are one link to Reports. Closed months, with Reopen, sit under the list.
 *
 * "Things to check" (the reconciliation checks, M07) joins the list here: it looks at every month, not only this one, so its row
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
  const session = useSession()
  const things = useMemo(() => (recon.data ? openFindings(session.status === 'signed-in' ? session.user.id : null, computeReconciliationExceptions(recon.data)) : null), [recon.data, session])

  return (
    <MoneyFrame active="month-end">
      <div className="flex flex-wrap items-center gap-3">
        <MonthPager month={ctx.month} thisMonth={ctx.thisMonth} go={ctx.go} />
        {ctx.state ? <MonthStateChip closed={isClosed} /> : null}
        <span className="flex-1" />
        {/* Match bank statement is the bank check's own row (and the clear line's link when it has nothing), never twice. */}
        <Link
          to={`/money/reports${ctx.search}`}
          className="inline-flex min-h-touch items-center gap-2 text-sm font-medium text-primary hover:underline md:min-h-0"
          data-testid="month-reports-link"
        >
          <Icon icon={ChartColumn} size="sm" />
          Reports for {monthName(ctx.month)}
          <Icon icon={ChevronRight} size="sm" />
        </Link>
      </div>

      {isClosed ? <LockBar month={ctx.month} /> : null}

      {ctx.statusError ? (
        <ReportError title="The checklist did not load" onRetry={ctx.refetch} />
      ) : !ctx.statusReady || !ctx.state ? (
        <ChecklistLoading />
      ) : ctx.state.kind === 'not-ended' && ctx.hasMoney === false ? (
        <section className="rounded border bg-surface">
          <EmptyState
            title={`Nothing to check for ${monthName(ctx.month)} yet`}
            actions={
              <>
                <Link to="/money/receivables" className="inline-flex h-control items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
                  Record a payment
                </Link>
                <Link to="/money/expenses?burst=1" className="inline-flex h-control items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
                  Add expenses
                </Link>
              </>
            }
          >
            No payments or expenses are recorded for {monthName(ctx.month)}. The current month cannot be closed; once it has ended this page lists its checks and Today shows &ldquo;Close {monthName(ctx.month)}&rdquo;.
            {ctx.closed.length ? ` ${closedThrough(ctx.closed)} and earlier are closed.` : ''}
          </EmptyState>
        </section>
      ) : (
        // Room under the last row for the phone's sticky action bar.
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

function LockBar({ month }: { month: string }) {
  const name = monthName(month)
  return (
    <div data-testid="lock-bar" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-tone-ink-bg px-5 py-3 text-sm text-tone-ink-fg">
      <Icon icon={Lock} size="md" />
      <span>
        <span className="font-medium">{monthKeyLabel(month)} is closed.</span> Payments, expenses and invoices dated in {name} are frozen.
      </span>
      <span className="flex-1" />
      <span className="text-sm opacity-90">Bank matching and the sent-to-customer and FBR dates stay open.</span>
    </div>
  )
}

/** The month, how many checks have items, and the one green button. On a phone the button is in the StickyActionBar. */
function Hero({ ctx, extra }: { ctx: MonthEndCtx; extra: number }) {
  const [open, setOpen] = useState(false)
  const state = ctx.state
  const closed = state?.kind === 'closed'
  const withItems = ctx.withItems + (extra > 0 ? 1 : 0)
  const day = closeWindowDay(ctx.month, ctx.today)
  const name = monthName(ctx.month)
  const phone = useMediaQuery('(max-width: 767px)')
  // The sticky bar replaces the bottom tabs on a phone (StickyActionBar's contract); the bar's back arrow leads out.
  useMobileBar({ title: 'Month end', back: 'history', fallback: '/money/receivables', hideTabs: true })
  const navigate = useNavigate()
  // A closed month's next step is reading its reports (reopening is in the list below), so that is the one green button.
  const button = (size: 'lg' | 'touch') =>
    closed ? (
      <Button size={size} variant="primary" icon={ChartColumn} onClick={() => navigate(`/money/reports${ctx.search}`)}>
        Reports for {name}
      </Button>
    ) : (
      <Button size={size} variant="primary" icon={Lock} disabled={state?.kind === 'not-ended'} onClick={() => setOpen(true)}>
        {state ? closeButtonLabel(ctx.month, state) : `Close ${name}`}
      </Button>
    )
  const tip = (
    <InfoTip label="About closing a month">
      {state?.kind === 'not-ended' ? <>{name} can be closed once it has ended. </> : null}
      Closing freezes payments, expenses and invoices dated in {name}. Bank matching and the sent-to-customer and FBR dates stay open. You can reopen
      it any time; both are written to the audit log. An earlier open month with money in it is closed in the same step.
    </InfoTip>
  )
  return (
    <section
      aria-label={`${monthKeyLabel(ctx.month)} summary`}
      className="grid items-center gap-x-8 gap-y-4 rounded border bg-surface px-6 py-5 md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="grid gap-1">
        {/* No chip in the heading (spec 1.2): the month's state is the Closed chip beside the pager and the lock bar. */}
        <h2 className="text-xl font-semibold tracking-snug">{monthKeyLabel(ctx.month)}</h2>
        <p className="text-base" data-testid="checks-summary">
          {withItems === 0 ? (
            'Every check is clear.'
          ) : (
            <>
              <b className="num font-semibold">{withItems}</b> {withItems === 1 ? 'check has' : 'checks have'} something to look at. None of them stops the close.
            </>
          )}
        </p>
        {/* Only a fact that matters: when it was closed, or how far into the 10-day close window we are. No bare date. */}
        {closed && ctx.closedEntry ? (
          <span className="text-sm text-fg-muted">Closed {formatClosedAt(ctx.closedEntry.closedAt)}</span>
        ) : day ? (
          <span className="text-sm text-fg-muted">Day {day} of the 10-day close window</span>
        ) : null}
      </div>
      {phone ? (
        // The phone's one action bar (spec 5.3), the same button as on desktop.
        <StickyActionBar label="Month end actions" primary={button('touch')} secondary={closed ? undefined : tip} />
      ) : (
        <div className="flex items-center gap-2">
          {button('lg')}
          {closed ? <span className="text-sm text-fg-muted">Reopen it from the list below.</span> : tip}
        </div>
      )}
      {closed ? null : <CloseMonthDialog open={open} onOpenChange={setOpen} ctx={ctx} />}
    </section>
  )
}

/** Only the checks that have items, one row each with its fix; the clear ones on one line (the phone pattern, everywhere). */
function CheckList({ ctx, things }: { ctx: MonthEndCtx; things: ReturnType<typeof computeReconciliationExceptions> | null }) {
  const rows: Row[] = ctx.cards.filter(c => !c.clear).map(fromCard)
  const clear: string[] = ctx.cards.filter(c => c.clear).map(c => c.label)
  // Still reachable when nothing is left to match (comparing totals, unticking a mistake): one link, on the clear line.
  const bankClear = ctx.cards.some(c => c.key === 'bank_unticked' && c.clear)
  if (things && things.length > 0) {
    const critical = things.filter(t => t.severity === 'critical').length
    rows.push({
      key: 'things_to_check',
      label: 'Things to check',
      n: things.length,
      parts: [`Orders, payments, invoices or costs that do not add up, in any month.${critical ? ` ${critical} ${critical === 1 ? 'is' : 'are'} serious.` : ''}`],
      linkLabel: 'Open things to check',
      to: '/money/exceptions',
    })
  } else if (things) clear.push('Things to check')
  return (
    <section aria-label="Checklist" className="grid gap-2">
      {rows.length > 0 ? (
        <ul className="grid overflow-hidden rounded border bg-surface">
          {rows.map(r => (
            <li key={r.key} data-testid={`check-${r.key}`} className="border-t first:border-t-0">
              <Link to={r.to} className="grid min-h-[64px] grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-4 pr-4 hover:bg-sunken md:grid-cols-[4px_minmax(0,1fr)_auto_auto]">
                <i aria-hidden="true" className="self-stretch bg-tone-warning-fg" />
                <span className="grid min-w-0 gap-1 py-3">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-base font-medium">
                    {r.label}
                    <span className="num text-base font-semibold text-tone-warning-fg">{r.n}</span>
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
                <span className="hidden text-sm font-medium text-primary md:inline">{r.linkLabel}</span>
                <Icon icon={ChevronRight} size="sm" className="text-fg-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {clear.length > 0 ? (
        <p data-testid="checks-clear" className="flex items-start gap-2 px-1 text-sm text-fg-2">
          <Icon icon={CircleCheck} size="sm" className="mt-[3px] shrink-0 text-tone-success-fg" />
          <span>
            <b className="font-medium text-fg">
              {clear.length} {clear.length === 1 ? 'check is' : 'checks are'} clear:
            </b>{' '}
            {clear.join(', ')}.
            {bankClear ? (
              <>
                {' '}
                <Link to={`/money/month-end/bank${ctx.search}`} data-testid="month-bank-link" className="font-medium text-primary hover:underline">
                  Match bank statement
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
    <Panel title="Closed months" meta={through ? <span className="text-sm text-fg-muted">Closed through {through}</span> : null} className="max-w-[720px]">
      {/* Closed months only (an open month here contradicted the title); the month on screen says Open or Closed above. */}
      <ul aria-label="Closed months">
        {shown.map(c => (
          <li
            key={c.key}
            data-testid={`closed-${c.key}`}
            className={cn('grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-t px-5 py-3 text-sm first:border-t-0', c.key === ctx.month && 'bg-selected')}
          >
            <Icon icon={Lock} size="md" className="text-fg-muted" />
            <span className="grid min-w-0">
              <span className="font-medium">{monthKeyLabel(c.key)}</span>
              <span className="text-sm text-fg-muted">
                Closed {formatClosedDay(c.closedAt, ctx.today)}
                {c.closedBy ? ` by ${c.closedBy}` : ''}
                {c.note ? ` · ${c.note}` : ''}
              </span>
            </span>
            {c.key === latest ? (
              <Button size="sm" onClick={() => onReopen(c)} aria-label={`Reopen ${monthKeyLabel(c.key)}`}>
                Reopen
              </Button>
            ) : (
              <span className="max-w-[16ch] text-right text-sm text-fg-muted" data-testid={`reopen-order-${c.key}`}>
                Reopen {latest ? monthKeyLabel(latest) : 'the later months'} first
              </span>
            )}
          </li>
        ))}
        {ctx.closed.length === 0 ? <li className="px-5 py-4 text-sm text-fg-2">None closed yet.</li> : null}
      </ul>
      {ctx.closed.length > 4 ? (
        <div className="border-t px-5 py-2">
          <Button size="sm" variant="quiet" onClick={() => setAll(a => !a)}>
            {all ? 'Show fewer' : `Show all ${ctx.closed.length} closed months`}
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}

function ChecklistLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the month-end checklist" className="grid gap-4">
      <div className="grid gap-3 rounded border bg-surface px-6 py-5 md:grid-cols-[1fr_auto]">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="grid overflow-hidden rounded border bg-surface">
        {[0, 1, 2].map(i => (
          <div key={i} className="grid gap-2 border-t px-5 py-4 first:border-t-0">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-full max-w-[480px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
