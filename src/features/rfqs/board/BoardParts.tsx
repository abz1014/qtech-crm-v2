import { Link } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { askedText, dueText, nextStepText, outcomeText, type BoardRow } from '@/features/rfqs/board/model'
import { formatDay } from '@/lib/formatDay'
import { orderRef, rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { StatusText } from '@/ui/StatusText'

/*
 * Cells of the RFQ board (R06, UX audit 2026-10-19). Each is a pure rendering of one BoardRow. A row leads with who and what
 * (the company, then what they asked for), and only then the code; the state is one plain "Next step", not three chips.
 * Table cells are nowrap by default (DataTable), so every cell here that holds sentences turns wrapping back on (whitespace-normal):
 * text wraps inside its own line instead of being cut or drawn over its neighbour (UX audit 2026-10-22, L1).
 */

/** The row link's name: the company, the code and what was asked, so two RFQs of one customer never read alike (WCAG 2.4.4). */
const linkName = (row: BoardRow) => `${row.companyName}, ${rfqRef(row.number)}, ${askedText(row)}`

function Priority() {
  return (
    <span className="inline-flex shrink-0 items-center text-tone-warning-fg" title="Top priority">
      <Icon icon={Flag} size="sm" />
      <span className="sr-only">Top priority</span>
    </span>
  )
}

/** "RFQ-0177 · their ref ENQ-2211": its own line, under what was asked. */
function Refs({ row }: { row: BoardRow }) {
  return (
    <span className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]" data-refs>
      <span className="num">{rfqRef(row.number)}</span>
      {row.customerRef ? ` · their ref ${row.customerRef}` : null}
    </span>
  )
}

/** Three lines: the company (the link that opens the RFQ), what they asked for, then the code and their reference. */
export function RfqCell({ row }: { row: BoardRow }) {
  return (
    <div className="grid min-w-[220px] max-w-[440px] gap-px whitespace-normal">
      <span className="flex min-w-0 items-center gap-[0.375rem]">
        <Link to={`/rfqs/${row.rfqId}`} title={row.companyName} aria-label={linkName(row)} className="min-w-0 font-medium text-fg hover:underline [overflow-wrap:anywhere]">
          {row.companyName}
        </Link>
        {row.isPriority ? <Priority /> : null}
      </span>
      <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]" data-asked title={askedText(row, 500)}>
        {askedText(row)}
      </span>
      <Refs row={row} />
    </div>
  )
}

/**
 * The one state on the row (StatusText, consistency spec 1.2): what happens next, with one short line behind it. The row grows to
 * fit: the detail wraps inside the column's width rather than being cut ("waiting on the customer for 1 answer").
 */
export function NextStepCell({ row }: { row: BoardRow }) {
  const s = nextStepText(row)
  return (
    <div className="min-w-0 whitespace-normal" data-next-step={s.step}>
      <StatusText tone={s.tone} detail={<span className="block [overflow-wrap:anywhere]">{s.detail}</span>} className="max-w-full [&>span]:min-w-0">
        {s.label}
      </StatusText>
    </div>
  )
}

/** The due date, with how far away it is. Overdue is the one danger-toned thing on the row. */
export function DueCell({ row }: { row: BoardRow }) {
  const due = dueText(row)
  const danger = due.tone === 'danger'
  return (
    <div className="grid gap-px whitespace-normal" data-due>
      <span className={cn('num', danger ? 'font-medium text-tone-danger-fg' : due.date ? 'text-fg' : 'text-fg-muted')}>{due.date ?? '—'}</span>
      <span className={cn('text-sm', danger ? 'text-tone-danger-fg' : due.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted')}>{due.hint}</span>
    </div>
  )
}

/**
 * The owner's avatar and first name. `avatarOnly` on the phone cards, where the first name would break mid-word beside the code
 * ("Tes / t", L2). The avatar carries the full name as its accessible name and title either way, so the first name is not read twice.
 */
export function OwnerCell({ row, avatarOnly = false }: { row: BoardRow; avatarOnly?: boolean }) {
  if (!row.ownerName) return <span className="shrink-0 whitespace-nowrap text-sm text-fg-muted">Unassigned</span>
  if (avatarOnly) return <Avatar name={row.ownerName} size="sm" />
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <Avatar name={row.ownerName} size="sm" />
      <span className="min-w-0 truncate" aria-hidden="true">
        {row.ownerName.split(' ')[0]}
      </span>
    </span>
  )
}

/**
 * The outcome in words (L3): "Lost on price", "Customer cancelled", or "Won → ORD-0012" with the order code as a link. No grey
 * "Closed" chip: every row on this list is closed, so the chip said nothing.
 */
export function OutcomeCell({ row }: { row: BoardRow }) {
  if (row.outcome === 'won')
    return (
      <span className="whitespace-normal font-medium text-tone-success-fg" data-outcome="won">
        Won
        {row.wonOrder ? (
          <>
            {' → '}
            <Link to={`/orders/${row.wonOrder.id}`} className="num text-fg underline underline-offset-2">
              {orderRef(row.wonOrder.number)}
            </Link>
          </>
        ) : null}
      </span>
    )
  return (
    <span className="whitespace-normal text-fg-2" data-outcome={row.outcome}>
      {outcomeText(row)}
    </span>
  )
}

/** The day it closed (for a won RFQ, the day its order was placed). */
export function ClosedOnCell({ row }: { row: BoardRow }) {
  return row.closedOn ? <span className="num text-fg-2">{formatDay(row.closedOn)}</span> : <span className="text-fg-muted">—</span>
}

export function ReceivedCell({ row }: { row: BoardRow }) {
  return <span className="num text-fg-2">{formatDay(row.receivedOn)}</span>
}

/*
 * The phone card (DataTable `mobileRow`, below 640px). Line 1: the company. Line 2: what was asked. Line 3: the next step, and the
 * due date on the right (danger when overdue). Last: the code and their ref, and the owner's avatar.
 */
export function OpenCard({ row }: { row: BoardRow }) {
  const due = dueText(row)
  const danger = due.tone === 'danger'
  const s = nextStepText(row)
  return (
    <div className="grid min-w-0 gap-1">
      <span className="flex min-w-0 items-center gap-[0.375rem]">
        <Link to={`/rfqs/${row.rfqId}`} title={row.companyName} aria-label={linkName(row)} className="min-w-0 font-medium text-fg hover:underline [overflow-wrap:anywhere]">
          {row.companyName}
        </Link>
        {row.isPriority ? <Priority /> : null}
      </span>
      <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{askedText(row)}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span data-next-step={s.step}>
          <StatusText tone={s.tone}>{s.label}</StatusText>
        </span>
        <span className={cn('text-sm', danger ? 'font-medium text-tone-danger-fg' : due.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted')}>
          {due.date ? (
            <>
              <span className="num">{due.date}</span>
              {due.hint ? ` · ${due.hint}` : null}
            </>
          ) : (
            'No due date'
          )}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Refs row={row} />
        <OwnerCell row={row} avatarOnly />
      </div>
    </div>
  )
}

export function ClosedCard({ row }: { row: BoardRow }) {
  return (
    <div className="grid min-w-0 gap-1">
      <Link to={`/rfqs/${row.rfqId}`} title={row.companyName} aria-label={linkName(row)} className="min-w-0 font-medium text-fg hover:underline [overflow-wrap:anywhere]">
        {row.companyName}
      </Link>
      <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{askedText(row)}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <OutcomeCell row={row} />
        {row.closedOn ? (
          <span className="text-fg-muted">
            · closed <span className="num">{formatDay(row.closedOn)}</span>
          </span>
        ) : null}
      </span>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Refs row={row} />
        <OwnerCell row={row} avatarOnly />
      </div>
    </div>
  )
}
