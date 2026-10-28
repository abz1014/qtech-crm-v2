import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useToast } from '@/ui/useToast'
import type { RfqItemRow } from '@/features/rfqs/api'
import { useCuratedCategories, useSetItemCategory } from '@/features/rfqs/hooks'
import type { SuggestionItem } from '@/features/rfqs/lib/supplierSuggestion'
import { useSuggestLib } from '@/features/rfqs/useSuggestLib'

/*
 * The category of an RFQ item, as a chip with a picker (C4). The category is rfq_items.family_id (a curated product category); it
 * decides "Deals in <category>" on the ask list. A solid chip is the item's own category. An item with none shows the keyword
 * dictionary's guess as a DASHED chip ("Contactors, guessed"): a guess is never saved by itself, tapping it opens the picker with
 * that guess first, and picking a category (the guess included) writes it. "No category" is dashed and muted. Admin and sales pick;
 * an engineer sees the chip and cannot change it. The chip is as tall as its line (22 px) and its 44 px tap target is an ::after that reaches past it, and sits above the item header's stretched tap target
 * (z-10, as the row menu does): without it, on a phone the header's ::after covered it and a Tab stop was hidden under it (2.4.11).
 */
const chip =
  "relative z-10 -my-px inline-flex items-center rounded border px-2 text-base leading-5 after:absolute after:inset-x-0 after:-inset-y-[11px] after:content-['']"

export function CategoryChip({ rfqId, item }: { rfqId: string; item: Pick<RfqItemRow, 'id' | 'description' | 'familyId' | 'familyName'> }) {
  const session = useSession()
  const canPick = session.status === 'signed-in' && (session.user.role === 'admin' || session.user.role === 'sales')
  // The category list is read once the suggestion code has arrived (after the first paint), not in the page's first round.
  const lib = useSuggestLib()
  const curated = useCuratedCategories(lib !== null)
  const set = useSetItemCategory(rfqId)
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const guess = useMemo(() => {
    // The dictionary's guess arrives with the suggestion code, after the first paint (perf: the page's first download).
    if (item.familyId || !lib) return null
    const g = lib.withCategories<SuggestionItem>([{ id: item.id, description: item.description, brandId: null, familyId: null }], curated.data ?? [])[0]
    return g.familyId ? { id: g.familyId, name: g.familyName ?? '' } : null
  }, [lib, item.id, item.description, item.familyId, curated.data])
  const options = useMemo(() => {
    const list = curated.data ?? []
    const own = item.familyId && !list.some(c => c.id === item.familyId) ? [{ id: item.familyId, name: item.familyName ?? 'This category' }] : []
    return [...own, ...list].sort((a, b) => (guess && a.id === guess.id ? -1 : guess && b.id === guess.id ? 1 : a.name.localeCompare(b.name)))
  }, [curated.data, item.familyId, item.familyName, guess])

  const label = item.familyName ?? (guess ? `${guess.name}, guessed` : 'No category')
  const style = item.familyName ? 'border-line-strong bg-surface text-fg-2' : cn('border-dashed border-line-strong', guess ? 'text-fg-2' : 'text-fg-muted')
  const choose = (familyId: string | null) => {
    setOpen(false)
    set.mutate(
      { id: item.id, familyId },
      { onError: err => toast({ title: 'Could not set the category', body: mapPgError(err, { entity: 'item' }).message, tone: 'danger' }) },
    )
  }

  if (!canPick) {
    return (
      <span className={cn(chip, style)} data-category-chip={item.familyName ? 'set' : guess ? 'guess' : 'none'}>
        {label}
      </span>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Category of item: ${label}. Change`} className={cn(chip, style, 'hover:bg-sunken')} data-category-chip={item.familyName ? 'set' : guess ? 'guess' : 'none'}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label="Product category" className="max-h-[320px] w-[280px] overflow-y-auto">
        <p className="px-1 pb-2 text-base font-medium">Product category</p>
        <ul className="grid gap-px">
          {options.map(o => (
            <li key={o.id}>
              <button type="button" onClick={() => choose(o.id)} className="flex min-h-touch w-full items-center gap-2 rounded px-2 text-left text-base hover:bg-sunken">
                <span className="min-w-0 flex-1">{o.name}</span>
                {o.id === item.familyId ? <Check aria-label="Current" className="size-4" /> : guess?.id === o.id ? <span className="text-base text-fg-muted">guess</span> : null}
              </button>
            </li>
          ))}
          {item.familyId ? (
            <li>
              <button type="button" onClick={() => choose(null)} className="flex min-h-touch w-full items-center rounded px-2 text-left text-base text-fg-2 hover:bg-sunken">
                No category
              </button>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
