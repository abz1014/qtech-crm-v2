import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { monthKeyLabel, monthKeyShort } from '@/features/money/monthEnd/model'

/*
 * The month controls Month end and the money reports share: the pager (the month rides in the address, ?month=2026-10) and the
 * Open or Closed chip. The old strip of Month-end views is gone (owner decision 2026-10-19: Money is two levels deep); the
 * checklist links to each fix and Reports lists every report.
 */

/** Previous and next month, the month between them. Next stops at the current month. */
export function MonthPager({ month, thisMonth, go, label = 'Month' }: { month: string; thisMonth: string; go: (by: number) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-[2px] rounded bg-selected p-[2px]">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => go(-1)}
        className="inline-flex h-control w-control items-center justify-center rounded px-2 text-fg-2 transition-colors duration-fast hover:text-fg"
      >
        <Icon icon={ChevronLeft} size="sm" />
      </button>
      <span aria-live="polite" title={monthKeyLabel(month)} className="num inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium">
        {monthKeyShort(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= thisMonth}
        onClick={() => go(1)}
        className="inline-flex h-control w-control items-center justify-center rounded px-2 text-fg-2 transition-colors duration-fast hover:text-fg disabled:text-fg-disabled disabled:hover:text-fg-disabled"
      >
        <Icon icon={ChevronRight} size="sm" />
      </button>
    </div>
  )
}

export function MonthStateChip({ closed }: { closed: boolean }) {
  return <StatusBadge dimension="month" value={closed ? 'closed' : 'open'} />
}
