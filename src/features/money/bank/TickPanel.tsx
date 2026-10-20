import { useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import type { BankLine, BankSide } from '@/features/money/bank/model'

/*
 * One list of the bank tick (g2-month-end "Bank tick"): a panel with the heading, the not-ticked lines first, then the
 * older not-ticked lines, then the ticked ones. A line is one button: tap to tick, tap again to undo. A PSID group
 * is one line; its invoices sit under it when there is more than one.
 */
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
  const tag = dir === 'in' ? 'Payments received' : 'Bank expenses and FBR deposits'
  const open = side.open.length + side.older.length

  const ticked = showAllTicked ? side.ticked : side.ticked.slice(0, COLLAPSED_TICKED)
  const older = showAllOlder ? side.older : side.older.slice(0, COLLAPSED_OLDER)

  return (
    <section aria-label={heading} data-testid={`bank-${dir}`} className="min-w-0 rounded border bg-surface">
      <header className="flex min-h-[52px] flex-wrap items-center gap-3 border-b py-2 pl-5 pr-4">
        <h2 className="text-base font-semibold">{heading}</h2>
        <span className="inline-flex h-[22px] items-center gap-[6px] rounded bg-selected px-2 text-xs font-medium text-fg-2">
          <Icon icon={dir === 'in' ? ArrowDownLeft : ArrowUpRight} size="sm" />
          {tag}
        </span>
        <span className="flex-1" />
        <span className="text-sm text-fg-muted">
          <span className="num">{side.ticked.length}</span> of <span className="num">{total}</span> ticked
        </span>
      </header>
      {total === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">
          {dir === 'in' ? 'No bank payments for this month.' : 'No bank expenses or FBR deposits for this month.'}
        </p>
      ) : (
        <div>
          {side.open.length > 0 ? (
            <>
              <GroupHead label="Not ticked" count={side.open.length} first />
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
              <GroupHead label="Ticked" count={side.ticked.length} first={open === 0} />
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
        'flex h-8 items-center justify-between gap-3 border-b bg-canvas px-5 text-xs font-medium text-fg-muted',
        !first && 'border-t',
      )}
    >
      <span>{label}</span>
      <span className="num text-fg-2">{count}</span>
    </div>
  )
}

function MoreButton({ open, hidden, word, onClick }: { open: boolean; hidden: number; word: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex h-10 w-full items-center gap-2 px-5 text-sm font-medium text-primary hover:bg-sunken"
    >
      <Icon icon={open ? ChevronUp : ChevronDown} size="sm" />
      {open ? 'Show fewer' : `${hidden} more ${word}`}
    </button>
  )
}

function Row({ line, just, onTick }: { line: BankLine; just: boolean; onTick: (l: BankLine) => void }) {
  const today = businessToday()
  const sub = line.kind === 'fbr' ? [...line.sub, `deposited ${formatShortDate(line.date, today)}`] : line.sub
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
        onClick={() => onTick(line)}
        className={cn(
          'grid min-h-[48px] w-full grid-cols-[28px_52px_minmax(0,1fr)_auto] items-center gap-3 border-b px-5 py-[6px] text-left transition-colors duration-fast ease-out hover:bg-sunken',
          group && 'bg-surface',
          just && 'bg-tone-success-bg hover:bg-tone-success-bg',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'grid size-[20px] place-items-center rounded-[3px] border border-line-input bg-surface text-primary-foreground',
            line.ticked && 'border-primary bg-primary',
          )}
        >
          <Check size={14} strokeWidth={2.5} className={cn(!line.ticked && 'opacity-0')} />
        </span>
        <span className={cn('num text-sm', quiet ? 'text-fg-muted' : just ? 'text-fg' : 'text-fg-2')}>
          {formatShortDate(line.date, today)}
        </span>
        <span className="grid min-w-0 gap-px">
          <span className={cn('line-clamp-2 text-sm', quiet ? 'font-regular text-fg-muted' : 'font-medium')}>{line.title}</span>
          <span className="line-clamp-2 text-xs text-fg-muted">
            {sub.map((part, i) => (
              <Part key={i} first={i === 0}>
                {part}
              </Part>
            ))}
          </span>
        </span>
        <span className={cn('text-sm', quiet && 'text-fg-muted')}>
          <Money value={line.amount} prefix={false} />
        </span>
      </button>
      {line.kids && line.kids.length > 1 ? (
        <div className="grid border-b bg-sunken">
          {line.kids.map(k => (
            <div
              key={k.id}
              className="grid min-h-8 grid-cols-[28px_52px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-[2px] text-xs text-fg-muted"
            >
              <span aria-hidden="true" className="h-full w-px justify-self-center bg-line-strong" />
              <span className="num">{k.date ? formatShortDate(k.date, today) : ''}</span>
              <span className="line-clamp-2">
                <span className="num text-fg-2">{k.number ?? 'No number'}</span>
                {k.company ? ` · ${k.company}` : ''} · GST
              </span>
              <Money value={k.amount} prefix={false} className="text-xs" />
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
