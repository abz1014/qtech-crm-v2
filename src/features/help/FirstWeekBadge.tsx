import { Check, Circle, Info } from 'lucide-react'
import { formatShortDate } from '@/lib/formatDay'
import { firstWeekRows, inFirstWeeks, type FirstWeekFacts, type FirstWeekMember } from '@/features/help/firstWeek'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { buttonStyles } from '@/ui/buttonStyles'
import { cn } from '@/lib/utils'

/**
 * "Setup 3 of 6 done" on a Team row (admin view), with an (i): it opens the list of first-use jobs for this person's role
 * with the date each was first done. Nothing for someone past their first 14 days, or a role with no checklist.
 * (Was "First week 3/6", which read as a code; audit 2026-10-22.)
 * Forest (82-help.html .hp-fw, 76-team.html): the trigger is a small secondary button; the popover lists each job with a tick or an
 * open circle and its date in tabular figures.
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
          className={cn(buttonStyles({ size: 'sm' }), 'num text-fg-2')}
          aria-label={`Setup ${done} of ${rows.length} done. Show the list`}
        >
          Setup {done} of {rows.length} done
          <Icon icon={Info} size="sm" className="text-fg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="Setup" className="grid w-[22rem] max-w-[calc(100vw-var(--sp-8))] gap-2 p-3 text-sm">
        <p className="font-bold text-fg">
          Setup: {done} of {rows.length} done
        </p>
        <p className="text-fg-muted">The everyday jobs for this role, each done once in the first two weeks.</p>
        <ul className="grid gap-2">
          {rows.map(r => (
            <li key={r.id} className="flex items-start gap-2">
              <Icon icon={r.doneOn ? Check : Circle} size="sm" className={r.doneOn ? 'mt-1 text-tone-success-fg' : 'mt-1 text-fg-muted'} />
              <span className="min-w-0 flex-1 break-words text-fg">{r.label}</span>
              <span className="num shrink-0 text-sm text-fg-muted">{r.doneOn === 'set' ? 'Done' : r.doneOn ? formatShortDate(r.doneOn.slice(0, 10)) : 'Not yet'}</span>
            </li>
          ))}
        </ul>
        <p className="text-fg-muted">Read from the work itself. Nothing extra is recorded.</p>
      </PopoverContent>
    </Popover>
  )
}
