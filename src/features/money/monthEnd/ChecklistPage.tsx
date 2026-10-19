import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ChartColumn,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clock,
  FileCheck,
  FileText,
  Hourglass,
  Info,
  Landmark,
  ListFilter,
  Lock,
  LockOpen,
  Pencil,
  History,
  Receipt,
  Scale,
  Truck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { formatPaisa, toPaisa, type Amount } from '@/lib/money'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { CloseMonthDialog, ReopenMonthDialog } from '@/features/money/monthEnd/MonthDialogs'
import { MonthEndFrame, MonthPager } from '@/features/money/monthEnd/MonthEndFrame'
import { useMonthEnd, type MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import { ExportCsvButton, ReportError, Panel } from '@/features/money/monthEnd/ReportParts'
import { csvFile, downloadReport } from '@/features/money/monthEnd/reportFiles'
import { closeWindowDay, formatClosedAt, formatClosedDay, longDay } from '@/features/money/monthEnd/format'
import { useAsOf, useAgingReport, useCategoryReport, useGstReport, useOweReport, usePnlReport, useTeamReport } from '@/features/money/monthEnd/reportHooks'
import {
  agingCsv,
  categoriesCsv,
  closeButtonLabel,
  closedThrough,
  gstCsv,
  monthName,
  payablesCsv,
  pnlCsv,
  teamCsv,
  type CheckCard,
  type ClosedMonth,
} from '@/features/money/monthEnd/model'

/*
 * Money › Month-end › Checklist (M10; admin only). Layout: g2-month-end "Checklist", "Closed state", "Phone 375".
 * Seven checks, each a warning with a count and a link to the fix; none blocks the close. "Close October" is two taps: the button,
 * then the confirmation. Under the checks, the reports for the month (each opens in its tab and exports to CSV in one tap) and the
 * closed months with their Reopen buttons.
 */
const GLYPH: Record<CheckCard['glyph'], LucideIcon> = {
  landmark: Landmark,
  receipt: Receipt,
  'list-filter': ListFilter,
  history: History,
  hourglass: Hourglass,
  'file-check': FileCheck,
  'circle-dashed': CircleDashed,
}

const Pkr = ({ v }: { v: Amount }) => <span className="num">PKR {formatPaisa(toPaisa(v))}</span>

export function ChecklistPage() {
  const ctx = useMonthEnd()
  const [reopen, setReopen] = useState<ClosedMonth | null>(null)
  const isClosed = ctx.state?.kind === 'closed'

  return (
    <MonthEndFrame active="checklist" ctx={ctx}>
      <div className="flex flex-wrap items-center gap-3">
        <MonthPager month={ctx.month} thisMonth={ctx.thisMonth} go={ctx.go} />
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
                <Link to="/money/expenses?add=1" className="inline-flex h-control items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
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
        <>
          <Hero ctx={ctx} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 max-md:hidden">
            {ctx.cards.map(c => (
              <CheckCardView key={c.key} card={c} />
            ))}
            <WhatClosingDoes month={ctx.month} className="md:col-span-2 xl:col-span-1" />
          </div>
          <PhoneList cards={ctx.cards} />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <ReportsList ctx={ctx} />
            <ClosedList ctx={ctx} onReopen={setReopen} />
          </div>
        </>
      )}
      <ReopenMonthDialog entry={reopen} onClose={() => setReopen(null)} />
    </MonthEndFrame>
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
      <span className="text-xs opacity-80">Bank ticks and TCS or FBR stamps stay editable.</span>
    </div>
  )
}

function Hero({ ctx }: { ctx: MonthEndCtx }) {
  const [open, setOpen] = useState(false)
  const state = ctx.state
  const closed = state?.kind === 'closed'
  const total = ctx.cards.length
  const clear = total - ctx.withItems
  const day = closeWindowDay(ctx.month, ctx.today)
  const name = monthName(ctx.month)
  return (
    <section
      aria-label={`${monthKeyLabel(ctx.month)} summary`}
      className="grid items-center gap-x-8 gap-y-4 rounded border bg-surface px-6 py-5 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <div className="grid gap-2">
        <h2 className="flex items-center gap-3 text-xl font-semibold tracking-snug">
          {monthKeyLabel(ctx.month)}
          <StatusBadge dimension="month" value={closed ? 'closed' : 'open'} />
        </h2>
        <span className="text-sm text-fg-muted">
          {closed && ctx.closedEntry
            ? `Closed ${formatClosedAt(ctx.closedEntry.closedAt)}`
            : day
              ? `${longDay(ctx.today)}: day ${day} of the 10-day close window`
              : longDay(ctx.today)}
        </span>
      </div>
      <div className="grid min-w-0 gap-2">
        <span className="text-base">
          <b className="num font-medium">
            {clear} of {total}
          </b>{' '}
          checks are clear. <b className="num font-medium">{ctx.withItems}</b> {ctx.withItems === 1 ? 'has items' : 'have items'} to review.
        </span>
        <div role="img" aria-label={`${clear} of ${total} checks clear`} className="flex gap-1">
          {ctx.cards.map(c => (
            <i
              key={c.key}
              className={cn(
                'block h-2 max-w-[44px] flex-1 rounded-[2px]',
                c.clear
                  ? 'bg-tone-success-fg'
                  : 'border border-tone-warning-fg bg-[repeating-linear-gradient(135deg,var(--tone-warning-fg)_0_2px,var(--bg-surface)_2px_4px)]',
              )}
            />
          ))}
        </div>
        <div className="flex gap-5 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-[6px]">
            <i className="size-[10px] rounded-[2px] bg-tone-success-fg" />
            Clear
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <i className="size-[10px] rounded-[2px] border border-tone-warning-fg bg-[repeating-linear-gradient(135deg,var(--tone-warning-fg)_0_2px,var(--bg-surface)_2px_4px)]" />
            Has items
          </span>
        </div>
      </div>
      <div className="grid justify-items-end gap-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:justify-items-stretch max-md:border-t max-md:bg-surface max-md:px-4 max-md:py-3 max-md:text-center">
        {closed ? (
          <>
            <Button size="lg" icon={Lock} disabled>
              Closed
            </Button>
            <span className="max-w-[28ch] text-right text-xs text-fg-muted max-md:max-w-none max-md:text-center">Reopen it from the closed-months list.</span>
          </>
        ) : (
          <>
            <Button
              size="lg"
              variant="primary"
              icon={Lock}
              disabled={state?.kind === 'not-ended'}
              onClick={() => setOpen(true)}
              className="max-md:h-touch"
            >
              {state ? closeButtonLabel(ctx.month, state) : `Close ${name}`}
            </Button>
            <span className="max-w-[28ch] text-right text-xs text-fg-muted max-md:max-w-none max-md:text-center">
              {state?.kind === 'not-ended' ? `${name} can be closed once it has ended.` : 'Warnings never block the close.'}
            </span>
            <CloseMonthDialog open={open} onOpenChange={setOpen} ctx={ctx} />
          </>
        )}
      </div>
    </section>
  )
}

function CheckCardView({ card }: { card: CheckCard }) {
  return (
    <article
      data-testid={`check-${card.key}`}
      data-clear={card.clear ? '' : undefined}
      className={cn(
        'grid min-w-0 grid-rows-[auto_auto_1fr_auto] gap-3 rounded border bg-surface px-5 py-4',
        card.clear ? 'border-t-2 border-t-tone-success-fg' : 'border-t-2 border-t-tone-warning-fg',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-fg-2">
        <span className="grid size-[28px] shrink-0 place-items-center rounded border border-line-strong bg-surface text-fg-muted">
          <Icon icon={GLYPH[card.glyph]} size="md" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-medium">{card.label}</h3>
        <ReviewChip clear={card.clear} />
      </div>
      <div className={cn('flex items-baseline gap-2', card.clear && 'text-fg-muted')}>
        <span className="num text-display font-medium tracking-tight">{card.n}</span>
        <span className="text-sm text-fg-muted">{card.unit}</span>
      </div>
      <p className="text-pretty text-xs text-fg-2">
        {card.parts.map((p, i) =>
          typeof p === 'string' ? (
            <Fragment key={i}>{p}</Fragment>
          ) : (
            <span key={i} className="num">
              {p.mono}
            </span>
          ),
        )}
      </p>
      <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm font-medium">
        {card.clear ? (
          <span className="inline-flex items-center gap-[6px] text-tone-success-fg">
            <Icon icon={CircleCheck} size="sm" />
            Nothing to do
          </span>
        ) : (
          <Link to={card.to} className="inline-flex items-center gap-1 text-primary hover:underline">
            {card.linkLabel}
            <Icon icon={ChevronRight} size="sm" />
          </Link>
        )}
      </div>
    </article>
  )
}

function ReviewChip({ clear }: { clear: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded border pl-[6px] pr-2 text-xs font-medium leading-none',
        clear
          ? 'border-tone-success-fg/25 bg-tone-success-bg text-tone-success-fg'
          : 'border-tone-warning-fg/25 bg-tone-warning-bg text-tone-warning-fg',
      )}
    >
      <Icon icon={clear ? CircleCheck : TriangleAlert} size="chip" />
      {clear ? 'Clear' : 'Review'}
    </span>
  )
}

function WhatClosingDoes({ month, className }: { month: string; className?: string }) {
  const name = monthName(month)
  const rows: { icon: LucideIcon; lead: string; rest: string }[] = [
    { icon: Lock, lead: 'Freezes', rest: ` payments, expenses and invoices dated in ${name}.` },
    { icon: Pencil, lead: 'Stays editable:', rest: ` bank ticks, and the TCS and FBR stamps. ${name}'s filing happens next month.` },
    { icon: History, lead: 'Reopen any time', rest: ' from the list on the right. Both actions are written to the audit log.' },
    { icon: Info, lead: 'Warnings never block.', rest: ' Only the order matters: an earlier month with money in it must be closed first, or closed in the same step.' },
  ]
  return (
    <aside className={cn('grid content-start gap-3 rounded border border-dashed border-line-input bg-canvas px-5 py-4 text-xs text-fg-2', className)}>
      <h3 className="text-sm font-semibold text-fg">What closing does</h3>
      <ul className="grid gap-2">
        {rows.map(r => (
          <li key={r.lead} className="grid grid-cols-[16px_1fr] items-start gap-2">
            <Icon icon={r.icon} size="sm" className="mt-px text-fg-muted" />
            <span>
              <b className="font-medium text-fg">{r.lead}</b>
              {r.rest}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** The phone's checklist (m-chips, .mck): one tappable row per check, an amber or green edge, the count and a chevron. */
function PhoneList({ cards }: { cards: CheckCard[] }) {
  return (
    <nav aria-label="Checklist" className="grid overflow-hidden rounded border bg-surface md:hidden">
      {cards.map(c => (
        <Link
          key={c.key}
          to={c.to}
          className="grid min-h-[56px] grid-cols-[4px_minmax(0,1fr)_auto_16px] items-center gap-3 border-t pr-3 first:border-t-0 hover:bg-sunken"
        >
          <i className={cn('self-stretch', c.clear ? 'bg-tone-success-fg' : 'bg-tone-warning-fg')} />
          <span className="grid min-w-0 gap-[2px] py-2">
            <span className="text-sm font-medium">{c.label}</span>
            <span className="truncate text-xs text-fg-muted">{c.clear ? 'Nothing to do' : c.sub}</span>
          </span>
          <span className={cn('num text-base font-medium', c.clear && 'text-fg-muted')}>{c.n}</span>
          <Icon icon={ChevronRight} size="sm" className="text-fg-muted" />
        </Link>
      ))}
    </nav>
  )
}

interface ReportRow {
  key: string
  icon: LucideIcon
  title: string
  to: string
  summary: ReactNode
  csv: (() => void) | null
}

function ReportsList({ ctx }: { ctx: MonthEndCtx }) {
  const { asOf } = useAsOf(ctx.month, ctx.today)
  const pnl = usePnlReport(ctx.month)
  const cat = useCategoryReport(ctx.month)
  const aging = useAgingReport(asOf)
  const owe = useOweReport(asOf)
  const gst = useGstReport(ctx.month)
  const team = useTeamReport(ctx.month, ctx.today)
  const m = ctx.month
  const name = monthName(m)
  const asOfWords = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7))}`

  const rows: ReportRow[] = [
    {
      key: 'pnl',
      icon: ChartColumn,
      title: 'Profit and loss',
      to: `/money/month-end/pnl${ctx.search}`,
      summary: pnl.view ? (
        <>
          Result <Pkr v={pnl.view.result} />, after drawings <Pkr v={pnl.view.afterDrawings} />
        </>
      ) : null,
      csv: pnl.view ? () => downloadReport(pnlCsv(pnl.view!), csvFile('profit-and-loss', m)) : null,
    },
    {
      key: 'categories',
      icon: FileText,
      title: 'Expenses by category',
      to: `/money/month-end/categories${ctx.search}`,
      summary: cat.view ? (
        <>
          <span className="num">{cat.view.all.count}</span> expenses, <Pkr v={cat.view.all.gross} /> paid
        </>
      ) : null,
      csv: cat.view ? () => downloadReport(categoriesCsv(cat.view!, m, 'all'), csvFile('expenses-by-category', m)) : null,
    },
    {
      key: 'aging',
      icon: Clock,
      title: `Aging, as of ${asOfWords}`,
      to: `/money/month-end/aging${ctx.search}`,
      summary: aging.view ? (
        <>
          <span className="num">{aging.view.rows.length}</span> {aging.view.rows.length === 1 ? 'invoice' : 'invoices'} open, <Pkr v={aging.view.outstanding} />
        </>
      ) : null,
      csv: aging.view ? () => downloadReport(agingCsv(aging.view!), csvFile('aging', m)) : null,
    },
    {
      key: 'owe',
      icon: Truck,
      title: 'We owe',
      to: `/money/month-end/owe${ctx.search}`,
      summary: owe.view ? (
        <>
          <span className="num">{owe.view.owedCount}</span> {owe.view.owedCount === 1 ? 'leg' : 'legs'} owed, about <Pkr v={owe.view.owed} />
        </>
      ) : null,
      csv: owe.view ? () => downloadReport(payablesCsv(owe.view!), csvFile('we-owe', m)) : null,
    },
    {
      key: 'gst',
      icon: Scale,
      title: 'GST and FBR month',
      to: `/money/month-end/gst${ctx.search}`,
      summary: gst.view ? (
        gst.view.selected ? (
          <>
            <span className="num">{gst.view.selected.invoiceCount}</span> {gst.view.selected.invoiceCount === 1 ? 'invoice' : 'invoices'}, GST <Pkr v={gst.view.selected.gst} />
          </>
        ) : (
          `No invoices dated in ${name}`
        )
      ) : null,
      csv: gst.view ? () => downloadReport(gstCsv(gst.view!), csvFile('gst-and-fbr', m)) : null,
    },
    {
      key: 'team',
      icon: Users,
      title: 'Team',
      to: `/money/month-end/team${ctx.search}`,
      summary: team.view ? (
        <>
          <span className="num">{team.view.creditedPeople}</span> {team.view.creditedPeople === 1 ? 'person' : 'people'}, net <Pkr v={team.view.credited} /> credited
        </>
      ) : null,
      csv: team.view ? () => downloadReport(teamCsv(team.view!, m), csvFile('team', m)) : null,
    },
  ]

  return (
    <Panel title={`Reports for ${name}`} meta={<span className="text-xs text-fg-muted">Each one opens in a tab and exports to CSV</span>}>
      <ul aria-label="Reports">
        {rows.map(r => (
          <li key={r.key} data-testid={`report-${r.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-3 first:border-t-0 md:min-h-[52px]">
            <span className="flex min-w-[200px] items-center gap-3 text-sm font-medium">
              <Icon icon={r.icon} size="md" className="text-fg-muted" />
              {r.title}
            </span>
            <span className="min-w-0 flex-1 text-sm text-fg-2 max-md:basis-full max-md:order-last">{r.summary ?? <Skeleton className="h-3 w-48" />}</span>
            <Link to={r.to} className="text-sm font-medium hover:underline">
              Open
            </Link>
            <ExportCsvButton onClick={() => r.csv?.()} disabled={!r.csv} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ClosedList({ ctx, onReopen }: { ctx: MonthEndCtx; onReopen: (c: ClosedMonth) => void }) {
  const [all, setAll] = useState(false)
  const through = closedThrough(ctx.closed)
  const shown = all ? ctx.closed : ctx.closed.slice(0, 4)
  const state = ctx.state
  return (
    <Panel title="Closed months" meta={through ? <span className="text-xs text-fg-muted">Closed through {through}</span> : null}>
      <ul aria-label="Closed months">
        {state?.kind === 'open' ? (
          <li className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 bg-selected px-5 py-3 text-sm">
            <Icon icon={LockOpen} size="md" className="text-tone-info-fg" />
            <span className="grid">
              <span className="font-medium">{monthKeyLabel(ctx.month)}</span>
              <span className="text-xs text-fg-muted">
                Open, <span className="num">{ctx.withItems}</span> {ctx.withItems === 1 ? 'check has' : 'checks have'} items
              </span>
            </span>
            <StatusBadge dimension="month" value="open" />
          </li>
        ) : null}
        {shown.map(c => (
          <li
            key={c.key}
            data-testid={`closed-${c.key}`}
            className={cn('grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-t px-5 py-3 text-sm first:border-t-0', c.key === ctx.month && 'bg-selected')}
          >
            <Icon icon={Lock} size="md" className="text-fg-muted" />
            <span className="grid min-w-0">
              <span className="font-medium">{monthKeyLabel(c.key)}</span>
              <span className="text-xs text-fg-muted">
                Closed {formatClosedDay(c.closedAt, ctx.today)}
                {c.closedBy ? ` by ${c.closedBy}` : ''}
                {c.note ? ` · ${c.note}` : ''}
              </span>
            </span>
            <Button size="sm" onClick={() => onReopen(c)} aria-label={`Reopen ${monthKeyLabel(c.key)}`}>
              Reopen
            </Button>
          </li>
        ))}
        {ctx.closed.length === 0 && state?.kind !== 'open' ? (
          <li className="px-5 py-6">
            <EmptyState title="No month is closed yet">Closing a month freezes what was paid and received in it.</EmptyState>
          </li>
        ) : null}
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
    <div aria-busy="true" aria-label="Loading the month-end checklist" className="grid gap-4">
      <div className="grid gap-3 rounded border bg-surface px-6 py-5 lg:grid-cols-[auto_1fr_auto]">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="grid gap-3 rounded border bg-surface px-5 py-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}
