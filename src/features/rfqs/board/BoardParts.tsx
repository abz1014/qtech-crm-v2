import { Link } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { clarificationDetail, CLOSE_REASON, dueText, sourcingDetail, type BoardRow } from '@/features/rfqs/board/model'
import { formatDay } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'

/* Cells of the RFQ board (R06). Each is a pure rendering of one BoardRow; the status words come from the U05 registry. */

/** Company over "RFQ-0177 · their ref ENQ-2211". The company is the link that opens the RFQ. */
export function CompanyCell({ row }: { row: BoardRow }) {
  return (
    <div className="grid min-w-0 gap-px">
      <span className="flex min-w-0 items-center gap-1.5">
        <Link to={`/rfqs/${row.rfqId}`} className="truncate font-medium text-fg hover:underline">
          {row.companyName}
        </Link>
        {row.isPriority ? (
          <span className="inline-flex shrink-0 items-center text-tone-warning-fg" title="Priority">
            <Icon icon={Flag} size="sm" />
            <span className="sr-only">Priority</span>
          </span>
        ) : null}
      </span>
      <span className="truncate text-xs text-fg-muted">
        <span className="num">{rfqRef(row.number)}</span>
        {row.customerRef ? <> · their ref {row.customerRef}</> : null}
      </span>
    </div>
  )
}

/** The due date, with how far away it is. Overdue is the one danger-toned thing on the row. */
export function DueCell({ row }: { row: BoardRow }) {
  const due = dueText(row)
  const danger = due.tone === 'danger'
  return (
    <div className="grid gap-px">
      <span className={cn('num', danger ? 'font-medium text-tone-danger-fg' : due.date ? 'text-fg' : 'text-fg-muted')}>{due.date ?? '—'}</span>
      <span className={cn('text-xs', danger ? 'text-tone-danger-fg' : due.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted')}>{due.hint}</span>
    </div>
  )
}

export function SourcingCell({ row }: { row: BoardRow }) {
  return (
    <div className="grid justify-items-start gap-0.5">
      <StatusBadge dimension="sourcing" value={row.sourcingState} detail={sourcingDetail(row)} />
      {row.itemsUncovered > 0 ? <span className="text-xs text-tone-danger-fg">{row.itemsUncovered} uncovered</span> : null}
    </div>
  )
}

/** A chip only when there is something to do or wait for; "No questions" would just be noise on every row. */
export function ClarificationCell({ row }: { row: BoardRow }) {
  if (row.clarificationState === 'none') return <span className="text-xs text-fg-muted">None</span>
  return <StatusBadge dimension="clarification" value={row.clarificationState} detail={clarificationDetail(row)} />
}

export function BidCell({ row }: { row: BoardRow }) {
  return <StatusBadge dimension="bid" value={row.bidState} />
}

export function OwnerCell({ row }: { row: BoardRow }) {
  if (!row.ownerName) return <span className="text-xs text-fg-muted">Unassigned</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={row.ownerName} size="sm" />
      <span className="truncate text-sm">{row.ownerName.split(' ')[0]}</span>
    </span>
  )
}

export function OutcomeCell({ row }: { row: BoardRow }) {
  return (
    <div className="grid justify-items-start gap-0.5">
      <StatusBadge dimension="rfq-outcome" value={row.outcome} />
      {row.outcome === 'closed' && row.closeReason ? <span className="text-xs text-fg-muted">{CLOSE_REASON[row.closeReason] ?? row.closeReason}</span> : null}
    </div>
  )
}

export function ReceivedCell({ row }: { row: BoardRow }) {
  return <span className="num text-fg-2">{formatDay(row.receivedOn)}</span>
}

/*
 * The phone card (DataTable `mobileRow`, below 640px). Line 1: company and RFQ ref. Line 2: due, in the
 * danger tone when overdue. Then the chips, wrapped. Last: the owner, and their ref when there is one.
 */
export function OpenCard({ row }: { row: BoardRow }) {
  const due = dueText(row)
  const danger = due.tone === 'danger'
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link to={`/rfqs/${row.rfqId}`} className="truncate font-medium text-fg hover:underline">
            {row.companyName}
          </Link>
          {row.isPriority ? (
            <span className="inline-flex shrink-0 items-center text-tone-warning-fg">
              <Icon icon={Flag} size="sm" />
              <span className="sr-only">Priority</span>
            </span>
          ) : null}
        </span>
        <span className="num shrink-0 text-xs text-fg-muted">{rfqRef(row.number)}</span>
      </div>
      <div className={cn('text-xs', danger ? 'font-medium text-tone-danger-fg' : due.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted')}>
        <span className="num">{due.date ?? 'No due date'}</span>
        {due.date && due.hint ? <> · {due.hint}</> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge dimension="sourcing" value={row.sourcingState} detail={sourcingDetail(row)} />
        {row.clarificationState !== 'none' ? <StatusBadge dimension="clarification" value={row.clarificationState} detail={clarificationDetail(row)} /> : null}
        <StatusBadge dimension="bid" value={row.bidState} />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <OwnerCell row={row} />
        {row.customerRef ? <span className="truncate">their ref {row.customerRef}</span> : null}
      </div>
    </div>
  )
}

export function ClosedCard({ row }: { row: BoardRow }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Link to={`/rfqs/${row.rfqId}`} className="truncate font-medium text-fg hover:underline">
          {row.companyName}
        </Link>
        <span className="num shrink-0 text-xs text-fg-muted">{rfqRef(row.number)}</span>
      </div>
      <OutcomeCell row={row} />
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <OwnerCell row={row} />
        <span className="num">Received {formatDay(row.receivedOn)}</span>
      </div>
    </div>
  )
}
