import { cn } from '@/lib/utils'

/**
 * A red dot, no number (redesign phase 5, plan section (c)): Money shows one only while an invoice is past its due date. It is the
 * only badge besides To do's number. Screen readers hear the words; `badge` pins it to the top-right of an icon (phone tabs); `silent` leaves the words to the caller (the tab's name).
 */
export function LateDot({ label = 'an invoice is late', badge = false, silent = false, className }: { label?: string; badge?: boolean; silent?: boolean; className?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-late-dot=""
        className={cn('inline-block size-[10px] shrink-0 rounded-round bg-tone-danger-fg', badge && 'absolute -right-[6px] -top-[4px] ring-2 ring-surface', className)}
      />
      {silent ? null : <span className="sr-only">{`, ${label}`}</span>}
    </>
  )
}
