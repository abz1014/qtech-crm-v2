import { Check, Circle, Info } from 'lucide-react'
import { formatShortDate } from '@/lib/formatDay'
import { firstWeekRows, inFirstWeeks, type FirstWeekFacts, type FirstWeekMember } from '@/features/help/firstWeek'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/**
 * "Setup 3 of 6 done" on a Team row (admin view), with an (i): it opens the list of first-use jobs for this person's role
 * with the date each was first done. Nothing for someone past their first 14 days, or a role with no checklist.
 * (Was "First week 3/6", which read as a code; audit 2026-10-22.)
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
          className="num inline-flex min-h-6 items-center gap-1 rounded-sm bg-selected px-2 py-[2px] text-sm font-medium text-fg-2 hover:bg-hover"
          aria-label={`Setup ${done} of ${rows.length} done. Show the list`}
        >
          Setup {done} of {rows.length} done
          <Icon icon={Info} size="sm" className="text-fg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="Setup" className="grid w-[300px] gap-2 p-3 text-sm">
        <p className="font-medium">
          Setup: {done} of {rows.length} done
        </p>
        <p className="text-fg-muted">The everyday jobs for this role, each done once in the first two weeks.</p>
        <ul className="grid gap-1">
          {rows.map(r => (
            <li key={r.id} className="flex items-start gap-2">
              <Icon icon={r.doneOn ? Check : Circle} size="sm" className={r.doneOn ? 'mt-[2px] text-tone-success-fg' : 'mt-[2px] text-fg-muted'} />
              <span className="flex-1">{r.label}</span>
              <span className="num text-sm text-fg-muted">{r.doneOn === 'set' ? 'Done' : r.doneOn ? formatShortDate(r.doneOn.slice(0, 10)) : 'Not yet'}</span>
            </li>
          ))}
        </ul>
        <p className="text-fg-muted">Read from the work itself. Nothing extra is recorded.</p>
      </PopoverContent>
    </Popover>
  )
}
