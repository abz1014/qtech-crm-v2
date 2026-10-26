import { useState } from 'react'
import { AlarmClockOff, CalendarDays, ChevronRight, UserRoundX } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { DateInput } from '@/ui/form/DateInput'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useToast } from '@/ui/useToast'
import { addDays, nextMonday } from '@/features/rfqs/lib/dateText'
import { useSnooze, useUnsnooze } from '@/features/today/hooks'
import { NOT_OURS_UNTIL } from '@/features/today/todoModel'
import { SNOOZE_RULE, type TodayItem } from '@/features/today/types'

/** Snooze: tomorrow, Monday or a date. One snooze per rule and subject; Undo puts back what was there. */
export function SnoozeMenu({ item, today, iconOnly = false }: { item: TodayItem; today: string; iconOnly?: boolean }) {
  const snooze = useSnooze()
  const unsnooze = useUnsnooze()
  const { toast } = useToast()
  const [picking, setPicking] = useState(false)
  const [date, setDate] = useState<string>(addDays(businessToday(), 2) ?? '')
  const rule = SNOOZE_RULE[item.rule]

  const apply = (untilOn: string, untilChange = false) => {
    snooze.mutate(
      { rule, subjectId: item.subjectId, untilOn, untilChange },
      {
        onSuccess: () =>
          toast({
            title: untilChange ? 'Marked not ours to chase' : `Snoozed until ${formatDay(untilOn)}`,
            body: untilChange ? `${item.ref} · ${item.party} comes back if the job changes.` : `${item.ref} · ${item.party}`,
            tone: 'neutral',
            undo: { onUndo: () => unsnooze.mutateAsync({ rule, subjectId: item.subjectId }).then(() => undefined) },
          }),
        onError: err => toast({ title: 'Could not snooze', body: mapPgError(err).message, tone: 'danger' }),
      },
    )
  }
  const tomorrow = addDays(today, 1) as string
  const monday = nextMonday(today)
  const short = (iso: string) => formatDay(iso).split(' ').slice(0, 2).join(' ')
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          {iconOnly ? (
            <Button variant="secondary" icon={AlarmClockOff} aria-label="Snooze" size="touch" />
          ) : (
            <Button variant="quiet" icon={AlarmClockOff}>
              Snooze
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label="Snooze until">
          <MenuItem onClick={() => apply(tomorrow)} hint={short(tomorrow)}>
            Tomorrow morning
          </MenuItem>
          <MenuItem onClick={() => apply(monday)} hint={formatDay(monday)}>
            Monday
          </MenuItem>
          <MenuItem icon={CalendarDays} onClick={() => setPicking(true)} hint={<Icon icon={ChevronRight} size="sm" />}>
            Pick a date
          </MenuItem>
          <MenuItem icon={UserRoundX} onClick={() => apply(NOT_OURS_UNTIL, true)}>
            Not ours to chase
          </MenuItem>
        </PopoverContent>
      </Popover>
      {iconOnly ? null : <InfoTip label="About snooze">Hides this item until the day you pick, or until the job changes (Not ours to chase). Only for you.</InfoTip>}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent
          title="Snooze until"
          context={`${item.ref} · ${item.party}`}
          icon={AlarmClockOff}
          footer={
            <>
              <Button data-cancel onClick={() => setPicking(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!date || date <= today}
                onClick={() => {
                  setPicking(false)
                  apply(date)
                }}
              >
                Snooze
              </Button>
            </>
          }
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Come back on</span>
            <DateInput value={date} onChange={setDate} defaultToday={false} aria-label="Snooze until" />
          </label>
          <p className="mt-2 text-xs text-fg-muted">It disappears from Today until that day.</p>
        </DialogContent>
      </Dialog>
    </>
  )
}
