import { CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * The Forest look of the supplier screens (proposal 22 to 24, proposal.css .qb-pick, .qb-chase, .qb-chip), shared by Suppliers to
 * ask, the Ask suppliers dialog, Suppliers asked, the New enquiry supplier step and Items and supplier prices, so the one list reads
 * the same wherever it opens. Tokens only: hairline, control corners (12), the deep band for a group heading, the 5 chip tones.
 */

/** The pick box: a hairline box with control corners that holds the rows edge to edge (.qb-pick). */
export const PICK_BOX = 'grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-clip rounded-control border bg-surface'
/** The same box run to the dialog's edges (.qb-pick-bleed): no side edges, no corners. */
export const PICK_BLEED = 'rounded-none border-x-0'
/** A group heading in the box (.qb-pick__grp): the deep band, bold words, its count in the muted regular face after a dot. */
export const PICK_GROUP = 'border-t bg-deep px-4 py-2 text-base font-bold first:border-t-0'
/** One row of the box (.qb-pick__row): the tick in its own column, everything else lined up under the name. */
export const PICK_ROW = 'relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border-t px-4 py-3 first:border-t-0'
/** A note at the top of the box (.qb-pick__note): the coverage line, the partial note, how many are ticked. */
export const PICK_NOTE = 'border-b border-dashed px-4 py-3 text-base text-fg-2 last:border-b-0'

/** A bordered box of sections (.qb-chase__box): the chase card, the reply's currency question. */
export const SECTION_BOX = 'grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-clip rounded-control border bg-surface'

/** A small pill in one of the tones (.qb-chip). */
const CHIP = 'inline-flex min-h-chip w-fit max-w-full items-center gap-1 rounded-pill py-px pl-2 pr-3 text-xs font-card leading-tight'

/** "suggested", a count: the quiet grey chip (.qb-chip[data-tone=inert]). */
export function QuietChip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(CHIP, 'bg-tone-neutral-bg px-3 text-tone-neutral-fg', className)}>{children}</span>
}

/** "Supplied this item before" (.qb-chip[data-tone=done] with its check): the one reason a supplier starts ticked. */
export function SuppliedBeforeChip({ className }: { className?: string }) {
  return (
    <span className={cn(CHIP, 'bg-tone-success-bg text-tone-success-fg', className)} data-badge="supplied-before">
      <Icon icon={CircleCheck} size="chip" className="size-icon-chip shrink-0" />
      Supplied this item before
    </span>
  )
}
