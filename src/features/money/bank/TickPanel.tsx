import { useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { CARD } from '@/ui/card'
import type { BankLine, BankSide } from '@/features/money/bank/model'

/*
 * One list of the bank tick (g2-month-end "Bank tick"): a panel with the heading, the not-ticked lines first, then the
 * older not-ticked lines, then the ticked ones. A line is one button: tap to tick, tap again to undo. A PSID group
 * is one line; its invoices sit under it when there is more than one.
 * Forest (58-money-checks .bk-panel): each list is the one card on every width; its rows run edge to edge inside it.
 */
/** The row grid: the tick box, the date, the line, the amount. The PSID group's invoices use it too, so their columns line up. */
// A phone drops the date column (58 .bk-d2): the date leads the line's detail instead, so the name keeps its width.
const ROW_COLS = 'grid-cols-[var(--sp-6)_minmax(0,1fr)_auto] sm:grid-cols-[var(--sp-6)_3.5rem_minmax(0,1fr)_auto]'
const COLLAPSED_TICKED = 6
const COLLAPSED_OLDER = 10

interface TickPanelProps {
  dir: 'in' | 'out'
  side: BankSide
  justTicked: string | null
  onTick: (line: BankLine) => void
}

export function TickPanel({ dir, side, justTicked, onTick }: TickPanelProps) {
  const [showAllTicked, setShowAllTicked] = useState(false)
  const [showAllOlder, setShowAllOlder] = useState(false)
  const total = side.ticked.length + side.open.length + side.older.length
  const heading = dir === 'in' ? 'Money in' : 'Money out'
  const tag = dir === 'in' ? 'Payments received' : 'Bank expenses and FBR payments'
  const open = side.open.length + side.older.length

  const ticked = showAllTicked ? side.ticked : side.ticked.slice(0, COLLAPSED_TICKED)
  const older = showAllOlder ? side.older : side.older.slice(0, COLLAPSED_OLDER)

  return (
    <section aria-label={heading} data-testid={`bank-${dir}`} className={cn(CARD, 'min-w-0 overflow-hidden')}>
      <header className="flex min-h-head flex-wrap items-center gap-x-3 gap-y-2 border-b px-card py-3">
        <h2 className="text-lg font-heavy">{heading}</h2>
        <span className="inline-flex min-h-6 min-w-0 items-center gap-1 rounded-pill bg-brand-100 px-2 text-xs font-bold text-fg-2 [overflow-wrap:anywhere]">
          <Icon icon={dir === 'in' ? ArrowDownLeft : ArrowUpRight} size="sm" />
          {tag}
        </span>
        <span className="flex-1" />
        <span className="text-sm text-fg-2">
          <span className="num">{side.ticked.length}</span> of <span className="num">{total}</span> matched
        </span>
      </header>
      {total === 0 ? (
        <p className="px-card py-5 text-base text-fg-2">
          {dir === 'in' ? 'No bank payments for this month.' : 'No bank expenses or FBR payments for this month.'}
        </p>
      ) : (
        <div>
          <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_auto] border-b px-card py-1 text-xs font-bold text-fg-muted">
            <span>Tick if on the statement</span>
            <span>PKR</span>
          </div>
          {side.open.length > 0 ? (
            <>
              <GroupHead label="Not matched yet" count={side.open.length} first />
              {side.open.map(l => (
                <Row key={l.key} line={l} just={justTicked === l.key} onTick={onTick} />
              ))}
            </>
          ) : null}
          {side.older.length > 0 ? (
            <>
              <GroupHead label="Older, not ticked in an earlier month" count={side.older.length} first={side.open.length === 0} />
              {older.map(l => (
                <Row key={l.key} line={l} just={justTicked === l.key} onTick={onTick} />
              ))}
              {side.older.length > COLLAPSED_OLDER ? (
                <MoreButton
                  open={showAllOlder}
                  hidden={side.older.length - COLLAPSED_OLDER}
                  word="older"
                  onClick={() => setShowAllOlder(v => !v)}
                />
              ) : null}
            </>
          ) : null}
          {side.ticked.length > 0 ? (
            <>
              <GroupHead label="Matched" count={side.ticked.length} first={open === 0} />
              {ticked.map(l => (
                <Row key={l.key} line={l} just={justTicked === l.key} onTick={onTick} />
              ))}
              {side.ticked.length > COLLAPSED_TICKED ? (
                <MoreButton
                  open={showAllTicked}
                  hidden={side.ticked.length - COLLAPSED_TICKED}
                  word="ticked"
                  onClick={() => setShowAllTicked(v => !v)}
                />
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}

function GroupHead({ label, count, first }: { label: string; count: number; first?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-8 items-center justify-between gap-3 border-b bg-canvas px-card py-1 text-xs font-bold text-fg-2',
        !first && 'border-t',
      )}
    >
      <span>{label}</span>
      <span className="num">{count}</span>
    </div>
  )
}

function MoreButton({ open, hidden, word, onClick }: { open: boolean; hidden: number; word: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-h-touch w-full items-center gap-2 border-b px-card last:border-b-0 text-base font-bold text-primary transition-colors duration-fast ease-out hover:bg-sunken"
    >
      <Icon icon={open ? ChevronUp : ChevronDown} size="sm" />
      {open ? 'Show fewer' : `${hidden} more ${word}`}
    </button>
  )
}

function Row({ line, just, onTick }: { line: BankLine; just: boolean; onTick: (l: BankLine) => void }) {
  const today = businessToday()
  const sub = line.kind === 'fbr' ? [...line.sub, `paid ${formatShortDate(line.date, today)}`] : line.sub
  const group = line.kind === 'fbr'
  const quiet = line.ticked && !just
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={line.ticked}
        data-testid="bank-row"
        data-key={line.key}
        title={line.psid ? `PSID ${line.psid}` : undefined}
        onClick={() => onTick(line)}
        className={cn(
          'grid min-h-row w-full items-center gap-3 border-b px-card py-2 text-left last:border-b-0 transition-[background-color,transform] duration-fast ease-out hover:bg-sunken active:scale-press motion-reduce:transition-none motion-reduce:active:scale-100',
          ROW_COLS,
          group && 'bg-surface',
          just && 'bg-tone-success-bg hover:bg-tone-success-bg',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'grid size-6 place-items-center rounded-[var(--sp-1)] border-2 border-line-input bg-surface text-primary-foreground transition-colors duration-fast ease-out',
            line.ticked && 'border-brand-700 bg-brand-700',
          )}
        >
          <Check size={14} strokeWidth={2.5} className={cn(!line.ticked && 'opacity-0')} />
        </span>
        <span className={cn('num text-sm max-sm:hidden', quiet ? 'text-fg-muted' : just ? 'text-fg' : 'text-fg-2')}>
          {formatShortDate(line.date, today)}
        </span>
        <span className="grid min-w-0 gap-px">
          <span className={cn('min-w-0 text-base [overflow-wrap:anywhere]', quiet ? 'font-medium text-fg-2' : 'font-bold')}>{line.title}</span>
          <span className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]">
            <span className="num sm:hidden">{formatShortDate(line.date, today)} · </span>
            {sub.map((part, i) => (
              <Part key={i} first={i === 0}>
                {part}
              </Part>
            ))}
          </span>
        </span>
        <span className={cn('text-base font-bold', quiet && 'font-medium text-fg-2')}>
          <Money value={line.amount} prefix={false} />
        </span>
      </button>
      {line.kids && line.kids.length > 1 ? (
        <div className="grid border-b bg-canvas last:border-b-0">
          {line.kids.map(k => (
            <div
              key={k.id}
              className={cn('grid min-h-8 items-center gap-3 px-card py-1 text-sm text-fg-muted', ROW_COLS)}
            >
              <span aria-hidden="true" className="h-full w-px justify-self-center bg-line-strong" />
              <span className="num max-sm:hidden">{k.date ? formatShortDate(k.date, today) : ''}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="num text-fg-2">{k.number ?? 'No number'}</span>
                {k.company ? ` · ${k.company}` : ''} · GST
              </span>
              <Money value={k.amount} prefix={false} className="text-sm" />
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** A sub-line part: refs (ORD-0042, INV-2284) in the darker mono, words in the muted text. */
function Part({ children, first }: { children: ReactNode; first: boolean }) {
  const text = String(children)
  const ref = /^(ORD|INV|RFQ)-\S+$/.test(text)
  return (
    <>
      {first ? '' : ' · '}
      {ref ? <span className="num text-fg-2">{text}</span> : text}
    </>
  )
}
