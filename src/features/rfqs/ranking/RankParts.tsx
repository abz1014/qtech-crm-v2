import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Banknote,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  FileCheck,
  History,
  Info,
  ListOrdered,
  Plus,
  Scale,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { rankNote, sellNote, type RankRow, type Reason, type ReasonIcon, type ReasonSet } from '@/features/rfqs/lib/ranking/reasons'

/*
 * The pieces of the ranked comparison (R25; g2-ranking-split frames 1 to 3 and the states). The rank badge, the note above an item's
 * rows, and the reasons under each supplier: one line while the row is closed, the full list when it is open. Every string comes
 * from lib/ranking/reasons.ts; this file only lays them out.
 */

const ICONS: Record<ReasonIcon, LucideIcon> = {
  best: Check,
  gap: ArrowRight,
  band: Scale,
  spread: Banknote,
  'sell-none': Info,
  'on-time': CircleCheck,
  late: TriangleAlert,
  few: CircleDashed,
  'none-yet': CircleDashed,
  history: History,
  evidence: FileCheck,
  rate: Clock,
  unranked: CircleAlert,
}

/** A reason's words, with its figures, dates and order numbers in the figure face. */
export function ReasonParts({ reason }: { reason: Reason }) {
  return (
    <>
      {reason.parts.map((p, i) => (p.num ? <span key={i} className="num text-fg">{p.text}</span> : <span key={i}>{p.text}</span>))}
    </>
  )
}

/** The rank in its own column: 1 is the dark square, a line that could not be ranked is a dashed dash. */
export function RankBadge({ row, className }: { row: Pick<RankRow, 'rank'>; className?: string }) {
  const none = row.rank === null
  return (
    <span
      title={none ? 'Not ranked' : `Rank ${row.rank}`}
      data-rank={row.rank ?? 'none'}
      className={cn(
        'num grid size-6 place-items-center rounded border text-xs font-medium leading-none',
        none ? 'border-dashed border-line-strong text-fg-muted' : row.rank === 1 ? 'border-tone-ink-bg bg-tone-ink-bg text-tone-ink-fg' : 'border-line-strong bg-surface text-fg-2',
        className,
      )}
    >
      {none ? '–' : row.rank}
      {none ? <span className="sr-only">Not ranked</span> : null}
    </span>
  )
}

/** The one line under a closed row: the reasons, in order, with a dot between them. */
function OneLine({ reasons }: { reasons: readonly Reason[] }) {
  return (
    <p className="flex items-start gap-2 text-xs text-fg-2" data-reasons="short">
      <Icon icon={ListOrdered} size="chip" className="mt-[2px] text-fg-muted" />
      <span className="text-pretty">
        {reasons.map((r, i) => (
          <span key={r.id + i} className={r.tone === 'warn' ? 'text-tone-warning-fg' : undefined}>
            {i > 0 ? <span className="text-line-strong"> · </span> : null}
            <ReasonParts reason={r} />
          </span>
        ))}
      </span>
    </p>
  )
}

/** The reasons for one supplier, closed (one line) or open (the list). `unrankedAction` is the "Add CNY rate" link of an unranked line. */
export function ReasonBlock({ set, open, unrankedCurrency, supplier }: { set: ReasonSet; open: boolean; unrankedCurrency?: string | null; supplier: string }) {
  return (
    <div className="grid gap-1" data-reasons-for={supplier}>
      {open ? (
        <ul className="mt-[2px] grid gap-[6px] rounded-r border-l-2 border-line-strong bg-sunken px-3 py-2" data-reasons="full">
          {set.full.map((r, i) => (
            <li
              key={r.id + i}
              data-reason={r.id}
              className={cn('grid grid-cols-[14px_minmax(0,1fr)] gap-2 text-xs text-fg-2', r.id === 'evidence' && 'text-fg-muted', r.tone === 'warn' && 'text-tone-warning-fg')}
            >
              <Icon icon={ICONS[r.icon]} size="chip" className={cn('mt-[2px]', r.tone === 'warn' ? 'text-tone-warning-fg' : 'text-fg-muted')} />
              <span className="text-pretty">
                <ReasonParts reason={r} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <OneLine reasons={set.short} />
      )}
      {unrankedCurrency ? (
        <Link
          to="/settings/exchange-rates"
          className="inline-flex h-control w-fit items-center gap-1 rounded border border-line-strong bg-surface px-2 text-sm font-medium hover:bg-sunken"
        >
          <Icon icon={Plus} size="sm" />
          {`Add ${unrankedCurrency} rate`}
        </Link>
      ) : null}
    </div>
  )
}

/** The note above an item's rows: how it was ranked, and (admin and sales only) what we would sell it for. */
export function RankNoteBar({ rows, showSell }: { rows: readonly RankRow[]; showSell: boolean }) {
  const note = rankNote(rows)
  const sell = sellNote(rows, showSell)
  const NoteIcon = note.kind === 'none' ? CircleAlert : note.kind === 'few' ? CircleDashed : ListOrdered
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface px-5 py-2 text-xs text-fg-muted" data-rank-note={note.kind}>
      <Icon icon={NoteIcon} size="chip" />
      <span className="min-w-0 flex-1 basis-64">
        <b className="font-medium text-fg-2">{note.title}</b> {note.body}
      </span>
      {sell ? (
        <span className={cn('inline-flex items-center gap-[6px]', sell.kind === 'none' ? 'text-fg-muted' : 'text-fg-2')} data-sell-note={sell.kind}>
          {sell.kind === 'none' ? (
            sell.text
          ) : (
            <>
              Selling price <span className="num font-medium text-fg">{sell.amount}</span> {sell.text}
            </>
          )}
        </span>
      ) : null}
    </div>
  )
}
