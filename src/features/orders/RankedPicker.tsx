import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { longReason, priceTexts, shortReason, type RankedQuote } from '@/features/orders/lib/ranking'

/*
 * The ranked supplier picker (A8; g2-ranking-split.html ".spl-sel" and ".spl-pop"). One button shows the chosen supplier with its rank and
 * the reason it sits there; it opens the item's ranked quotes, each with the reason in plain words and the price in the quote's currency
 * and in PKR. A supplier already used by another part of the same item is listed but cannot be picked again (the database refuses the same
 * quote line twice). Used by the convert dialog (O08); the Split line dialog (O09) lists the same rows with RankedOptionRow.
 *
 * `extras` are the words the convert dialog also allows on a line ("Not sourced yet", "Service, no supplier"). Selling price and spread
 * show only when the rows carry them (admin and sales; the database sends NULL to an engineer).
 */

export function RankBadge({ rank, className }: { rank: number | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'num grid size-6 shrink-0 place-items-center rounded border text-xs font-medium leading-none',
        rank === 1 ? 'border-ink-bg bg-ink-bg text-ink-fg' : rank ? 'border-line-strong bg-surface text-fg-2' : 'border-dashed border-line-input text-fg-muted',
        className,
      )}
    >
      {rank ?? '–'}
    </span>
  )
}

export interface PickerExtra {
  value: string
  label: string
}

/** One ranked quote as a row: rank, supplier and reason on the left, price on the right. */
export function RankedOptionRow({ q, among, className }: { q: RankedQuote; among: readonly RankedQuote[]; className?: string }) {
  const p = priceTexts(q)
  return (
    <span className={cn('grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2', className)}>
      <RankBadge rank={q.rank} />
      <span className="grid min-w-0">
        <b className="text-sm font-medium leading-[18px]">{q.supplierName}</b>
        <span className="text-xs text-fg-muted">{longReason(q, among)}</span>
      </span>
      <span className="num text-right text-xs">
        {p.price}
        <em className="block font-sans not-italic text-fg-muted">{p.pkr}</em>
      </span>
    </span>
  )
}

export function RankedPicker({
  label,
  value,
  quotes,
  extras = [],
  usedLineIds,
  usedNote,
  onChange,
  header = 'Ranked quotes for this item, with the reason',
}: {
  label: string
  value: string
  quotes: readonly RankedQuote[]
  extras?: readonly PickerExtra[]
  /** Quote lines other parts of the same item already use. */
  usedLineIds?: ReadonlySet<string>
  usedNote?: ReactNode
  onChange: (value: string) => void
  header?: string
}) {
  const [open, setOpen] = useState(false)
  const chosen = quotes.find(q => q.lineId === value)
  const extra = extras.find(e => e.value === value)
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          className="grid min-h-[36px] w-full grid-cols-[24px_minmax(0,1fr)_16px] items-center gap-2 rounded border border-line-input bg-surface px-2 py-1 text-left hover:border-fg-muted"
        >
          <RankBadge rank={chosen?.rank ?? null} />
          <span className="grid min-w-0 leading-[17px]">
            <span className="sr-only">{label}: </span>
            <b className="truncate text-sm font-medium">{chosen ? chosen.supplierName : (extra?.label ?? 'Choose a supplier')}</b>
            {chosen ? <span className="text-pretty text-xs text-fg-muted">{shortReason(chosen, quotes)}</span> : null}
          </span>
          <Icon icon={ChevronDown} size="sm" className="text-fg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(520px,calc(100vw-32px))] max-w-none p-1">
        <p className="px-2 pb-1 pt-2 text-xs font-medium leading-snug text-fg-muted">{header}</p>
        <div role="listbox" aria-label={header}>
          {quotes.map(q => {
            const used = usedLineIds?.has(q.lineId) && q.lineId !== value
            return (
              <button
                key={q.lineId}
                type="button"
                role="option"
                aria-selected={q.lineId === value}
                disabled={used}
                onClick={() => pick(q.lineId)}
                className={cn('block w-full rounded p-2 text-left hover:bg-sunken disabled:opacity-55 disabled:hover:bg-transparent', q.lineId === value && 'bg-selected')}
              >
                <RankedOptionRow q={q} among={quotes} />
              </button>
            )
          })}
          {extras.map((e, i) => (
            <button
              key={e.value}
              type="button"
              role="option"
              aria-selected={e.value === value}
              onClick={() => pick(e.value)}
              className={cn(
                'grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded p-2 text-left text-sm hover:bg-sunken',
                e.value === value && 'bg-selected',
                i === 0 && quotes.length > 0 && 'mt-1 rounded-t-none border-t border-line',
              )}
            >
              <RankBadge rank={null} />
              <span>{e.label}</span>
            </button>
          ))}
        </div>
        {usedNote ? <p className="mt-0.5 border-t border-line px-2 pb-0.5 pt-1.5 text-xs text-fg-muted">{usedNote}</p> : null}
      </PopoverContent>
    </Popover>
  )
}
