import { Link } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { askedText, CLOSE_REASON, dueText, nextStepText, type BoardRow, type NextStepText } from '@/features/rfqs/board/model'
import { formatDay } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'

/*
 * Cells of the RFQ board (R06, UX audit 2026-10-19). Each is a pure rendering of one BoardRow. A row leads with who and what
 * (the company, then what they asked for), and only then the code; the state is one plain "Next step", not three chips.
 */

/** The row link's name: the company, the code and what was asked, so two RFQs of one customer never read alike (WCAG 2.4.4). */
const linkName = (row: BoardRow) => `${row.companyName}, ${rfqRef(row.number)}, ${askedText(row)}`

const TONE: Record<NextStepText['tone'], string> = {
  warning: 'text-tone-warning-fg',
  info: 'text-tone-info-fg',
  success: 'text-tone-success-fg',
  neutral: 'text-fg-2',
}

function Priority() {
  return (
    <span className="inline-flex shrink-0 items-center text-tone-warning-fg" title="Top priority">
      <Icon icon={Flag} size="sm" />
      <span className="sr-only">Top priority</span>
    </span>
  )
}

/** Company over "what they asked for · RFQ-0177 · their ref ENQ-2211". The company is the link that opens the RFQ. */
export function RfqCell({ row }: { row: BoardRow }) {
  return (
    <div className="grid min-w-0 gap-px">
      <span className="flex min-w-0 items-center gap-1.5">
        <Link to={`/rfqs/${row.rfqId}`} title={row.companyName} aria-label={linkName(row)} className="min-w-0 font-medium text-fg hover:underline [overflow-wrap:anywhere]">
          {row.companyName}
        </Link>
        {row.isPriority ? <Priority /> : null}
      </span>
      <span className="flex min-w-0 items-baseline gap-1 text-sm text-fg-muted">
        <span className="min-w-0 text-fg-2 [overflow-wrap:anywhere]" data-asked title={askedText(row, 500)}>
          {askedText(row)}
        </span>
        <span className="num shrink-0">· {rfqRef(row.number)}</span>
        {row.customerRef ? <span className="min-w-0 [overflow-wrap:anywhere]" title={`Their ref ${row.customerRef}`}>· their ref {row.customerRef}</span> : null}
      </span>
    </div>
  )
}

/** The one state on the row: what happens next, with one short line behind it. */
export function NextStepCell({ row }: { row: BoardRow }) {
  const s = nextStepText(row)
  return (
    <div className="grid min-w-0 gap-px" data-next-step={s.step}>
      <span className={cn('flex items-center gap-2 font-medium', TONE[s.tone])}>
        <i aria-hidden="true" className="size-2 shrink-0 rounded-round bg-current" />
        {s.label}
      </span>
      <span className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]" title={s.detail}>{s.detail}</span>
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
      <span className={cn('text-sm', danger ? 'text-tone-danger-fg' : due.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted')}>{due.hint}</span>
    </div>
  )
}

export function OwnerCell({ row }: { row: BoardRow }) {
  if (!row.ownerName) return <span className="text-sm text-fg-muted">Unassigned</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={row.ownerName} size="sm" />
      <span className="min-w-0 [overflow-wrap:anywhere]" title={row.ownerName}>{row.ownerName.split(' ')[0]}</span>
    </span>
  )
}

export function OutcomeCell({ row }: { row: BoardRow }) {
  return (
    <div className="grid justify-items-start gap-0.5">
      <StatusBadge dimension="rfq-outcome" value={row.outcome} />
      {row.outcome === 'closed' && row.closeReason ? <span className="text-sm text-fg-muted">{CLOSE_REASON[row.closeReason] ?? row.closeReason}</span> : null}
    </div>
  )
}

export function ReceivedCell({ row }: { row: BoardRow }) {
  return <span className="num text-fg-2">{formatDay(row.receivedOn)}</span>
}

/*
 * The phone card (DataTable `mobileRow`, below 640px). Line 1: the company. Line 2: what was asked. Line 3: the next step, and the
 * due date on the right (danger when overdue). Last: the code and their ref, and the owner.
 */
export function OpenCard({ row }: { row: BoardRow }) {
  const due = dueText(row)
  const danger = due.tone === 'danger'
  const s = nextStepText(row)
  return (
    <div className="grid min-w-0 gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <Link to={`/rfqs/${row.rfqId}`} title={row.companyName} aria-label={linkName(row)} className="min-w-0 font-medium text-fg hover:underline [overflow-wrap:anywhere]">
          {row.companyName}
        </Link>
        {row.isPriority ? <Priority /> : null}
      </span>
      <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{askedText(row)}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={cn('flex items-center gap-2 text-sm font-medium', TONE[s.tone])} data-next-step={s.step}>
          <i aria-hidden="true" className="size-2 shrink-0 rounded-round bg-current" />
          {s.label}
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
      <div className="flex min-w-0 items-center justify-between gap-3 text-sm text-fg-muted">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="num">{rfqRef(row.number)}</span>
          {row.customerRef ? ` · their ref ${row.customerRef}` : null}
        </span>
        <OwnerCell row={row} />
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
      <OutcomeCell row={row} />
      <div className="flex min-w-0 items-center justify-between gap-3 text-sm text-fg-muted">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="num">{rfqRef(row.number)}</span> · received <span className="num">{formatDay(row.receivedOn)}</span>
        </span>
        <OwnerCell row={row} />
      </div>
    </div>
  )
}
