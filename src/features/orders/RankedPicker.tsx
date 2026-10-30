import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { priceTexts, type RankedQuote } from '@/features/orders/lib/ranking'
import { rovingKeyDown, rovingTabIndex } from '@/ui/roving'

/*
 * The supplier picker (A8; g2-ranking-split.html ".spl-sel" and ".spl-pop"). One button shows the chosen supplier and its price; it opens the
 * item's quotes by supplier name, each with the price in the quote's currency and in PKR. NO RANK, MARK OR REASON: the CRM never suggests a
 * supplier (owner decision 2026-10-29). A supplier already used by another part of the same item is listed but cannot be picked again (the database refuses the same
 * quote line twice). Used by the convert dialog (O08); the Split line dialog (O09) lists the same rows with RankedOptionRow.
 *
 * `extras` are the words the convert dialog also allows on a line ("Not sourced yet", "Service, no supplier"). Selling price and spread
 * show only when the rows carry them (admin and sales; the database sends NULL to an engineer).
 */

export interface PickerExtra {
  value: string
  label: string
}

/** One quote as a row: the supplier on the left (and "In stock" when it said so), the price on the right. No rank, mark or reason. */
export function RankedOptionRow({ q, className }: { q: RankedQuote; among?: readonly RankedQuote[]; className?: string }) {
  const p = priceTexts(q)
  return (
    <span className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2', className)}>
      <span className="grid min-w-0">
        <b className="text-sm font-medium leading-[18px]">{q.supplierName}</b>
        {q.inStock ? <span className="text-xs text-fg-muted">In stock</span> : null}
      </span>
      <span className="num text-right text-xs">
        {p.price}
        <em className="block font-sans not-italic text-fg-muted">{p.pkr}</em>
      </span>
    </span>
  )
}

export function RankedPicker({
  id,
  label,
  value,
  quotes,
  extras = [],
  usedLineIds,
  usedNote,
  onChange,
  header = 'Quotes for this item, by supplier',
}: {
  /** The trigger's id, so a message can take the person to it. */
  id?: string
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
  const sel = [...quotes.map(q => q.lineId), ...extras.map(e => e.value)].indexOf(value ?? '')
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-haspopup="listbox"
          className="grid min-h-[36px] w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded border border-line-input bg-surface px-2 py-1 text-left hover:border-fg-muted"
        >
          <span className="grid min-w-0 leading-[17px]">
            <span className="sr-only">{label}: </span>
            <b className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium">{chosen ? chosen.supplierName : (extra?.label ?? 'Choose a supplier')}</b>
            {chosen ? <span className="num text-pretty text-xs text-fg-muted">{priceTexts(chosen).price}</span> : null}
          </span>
          <Icon icon={ChevronDown} size="sm" className="text-fg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(520px,calc(100vw-32px))] max-w-none p-1">
        <p className="px-2 pb-1 pt-2 text-xs font-medium leading-snug text-fg-muted">{header}</p>
        {/* One Tab stop; arrows, Home and End move; Enter or Space picks. */}
        <div role="listbox" aria-label={header} onKeyDown={e => rovingKeyDown(e, { item: '[role=option]' })}>
          {quotes.map((q, qi) => {
            const used = usedLineIds?.has(q.lineId) && q.lineId !== value
            return (
              <button
                key={q.lineId}
                type="button"
                role="option"
                aria-selected={q.lineId === value}
                tabIndex={rovingTabIndex(qi, sel)}
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
              tabIndex={rovingTabIndex(quotes.length + i, sel)}
              onClick={() => pick(e.value)}
              className={cn(
                'grid w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-sunken',
                e.value === value && 'bg-selected',
                i === 0 && quotes.length > 0 && 'mt-1 rounded-t-none border-t border-line',
              )}
            >
              <span>{e.label}</span>
            </button>
          ))}
        </div>
        {usedNote ? <p className="mt-[0.125rem] border-t border-line px-2 pb-[0.125rem] pt-[0.375rem] text-xs text-fg-muted">{usedNote}</p> : null}
      </PopoverContent>
    </Popover>
  )
}
