import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { monthKeyLabel, monthKeyShort } from '@/features/money/monthEnd/model'

/*
 * The month controls Lock a month and the money reports share: the pager (the month rides in the address, ?month=2026-10) and the
 * Closed chip (an open month has none: Open is a hidden key, spec 1.5). The old strip of Month-end views is gone (owner decision 2026-10-19: Money is two levels deep); the
 * checklist links to each fix and Reports lists every report.
 */

/** Forest (.qb-monthbar__step): the outlined step button of a month or period pager. */
export const PAGER_STEP =
  'inline-grid h-control w-control shrink-0 place-items-center rounded-control border border-line-input bg-surface text-fg transition-[background-color,transform] duration-fast ease-out hover:bg-brand-100 active:scale-press disabled:border-line disabled:bg-sunken disabled:text-fg-disabled disabled:hover:bg-sunken disabled:active:scale-100 motion-reduce:transition-none max-md:h-touch max-md:w-touch'

/** Previous and next month, the month between them. Next stops at the current month. */
export function MonthPager({ month, thisMonth, go, label = 'Month' }: { month: string; thisMonth: string; go: (by: number) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-2">
      <button type="button" aria-label="Previous month" onClick={() => go(-1)} className={PAGER_STEP}>
        <Icon icon={ChevronLeft} size="sm" />
      </button>
      <span aria-live="polite" title={monthKeyLabel(month)} className="num inline-flex h-control min-w-[6.5rem] items-center justify-center px-2 text-base font-bold max-md:h-touch">
        {monthKeyShort(month)}
      </span>
      <button type="button" aria-label="Next month" disabled={month >= thisMonth} onClick={() => go(1)} className={PAGER_STEP}>
        <Icon icon={ChevronRight} size="sm" />
      </button>
    </div>
  )
}

export function MonthStateChip({ closed }: { closed: boolean }) {
  return <StatusBadge dimension="month" value={closed ? 'closed' : 'open'} />
}
