import { Check, Circle } from 'lucide-react'
import { formatShortDate } from '@/lib/formatDay'
import { firstWeekRows, inFirstWeeks, type FirstWeekFacts, type FirstWeekMember } from '@/features/help/firstWeek'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/**
 * "First week 3/6" on a Team row (admin view). Opens the list of items with the date each was first done. Nothing for
 * someone past their first 14 days, or a role with no checklist.
 */
export function FirstWeekBadge({ member, facts }: { member: FirstWeekMember; facts: FirstWeekFacts | undefined }) {
  if (!facts || !inFirstWeeks(member)) return null
  const rows = firstWeekRows(member, facts)
  if (rows.length === 0) return null
  const done = rows.filter(r => r.doneOn).length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="num rounded-sm bg-selected px-2 py-[2px] text-xs font-medium text-fg-2 hover:bg-hover"
          aria-label={`First week: ${done} of ${rows.length} done. Show the list`}
        >
          First week {done}/{rows.length}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="First week" className="grid w-[300px] gap-2 p-3 text-sm">
        <p className="font-medium">First week: {done} of {rows.length}</p>
        <ul className="grid gap-1">
          {rows.map(r => (
            <li key={r.id} className="flex items-start gap-2">
              <Icon icon={r.doneOn ? Check : Circle} size="sm" className={r.doneOn ? 'mt-[2px] text-tone-success-fg' : 'mt-[2px] text-fg-muted'} />
              <span className="flex-1">{r.label}</span>
              <span className="num text-xs text-fg-muted">{r.doneOn === 'set' ? 'Done' : r.doneOn ? formatShortDate(r.doneOn.slice(0, 10)) : 'Not yet'}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-muted">Read from the work itself. Nothing extra is recorded.</p>
      </PopoverContent>
    </Popover>
  )
}
