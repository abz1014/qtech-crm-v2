import { useState } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { pkr } from '@/lib/formRules'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { NumberInput } from '@/ui/form/NumberInput'
import { useToast } from '@/ui/useToast'
import { useCategories, useRecordRecurring } from '@/features/money/expenses/hooks'
import { monthKeyLabel, type RecurringTemplate } from '@/features/money/expenses/model'
import { badLines, reminderLines, reminderTotal, type ReminderBill } from '@/features/money/expenses/reminder'
import { SnoozeMenu } from '@/features/today/SnoozeMenu'
import type { TodayItem } from '@/features/today/types'

/*
 * The To do item for recurring bills (0138): every bill that is due, each with its amount (change it first for a bill that
 * varies, like electricity), and one "Record all (PKR X)". Recording is safe to repeat: (recurring_id, period) is unique, so a bill
 * another tab or the "Book it for me" job already recorded is skipped, not doubled. Text is 16px and up.
 */
export function RecurringReminder({ item, bills, today, compact }: { item: TodayItem; bills: readonly ReminderBill[]; today: string; compact?: boolean }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const categories = useCategories(true)
  const record = useRecordRecurring()
  const [edits, setEdits] = useState<Record<string, number | null>>({})
  const [busy, setBusy] = useState(false)

  const lines = reminderLines(bills, today, categories.data ?? [], edits)
  const bad = badLines(lines)
  const total = reminderTotal(lines)

  const recordAll = async () => {
    setBusy(true)
    let done = 0
    let sum = 0
    const failed: string[] = []
    for (const l of lines) {
      const template: RecurringTemplate = {
        id: l.id,
        label: l.label,
        categoryId: l.categoryId,
        amount: l.amount,
        dayOfMonth: l.dayOfMonth,
        active: true,
        startMonth: null,
        notes: null,
        paidVia: l.paidVia,
      }
      try {
        await record.mutateAsync({ template, id: crypto.randomUUID(), period: l.period, paidOn: l.paidOn, paidVia: l.paidVia })
        done += 1
        sum += l.amount
      } catch (e) {
        // already recorded (another tab, or Book it for me): not an error
        if (mapPgError(e, { entity: 'expense' }).kind !== 'unique') failed.push(l.label)
      }
    }
    setBusy(false)
    if (done > 0) toast({ title: `Recorded ${done} recurring ${done === 1 ? 'expense' : 'expenses'}`, body: `${pkr(sum)} · ${[...new Set(lines.map(l => monthKeyLabel(l.period)))].join(' and ')}`, tone: 'success' })
    if (failed.length > 0) toast({ title: `Could not record ${failed.join(', ')}`, body: 'Nothing else was changed. Try again.', tone: 'danger' })
  }

  const loading = categories.isPending
  return (
    <section aria-label="Recurring bills to record" className="grid gap-4 rounded-panel border bg-surface p-4" data-testid="recurring-reminder">
      <p className="text-base text-fg-2">These bills have no entry yet. Change an amount if the bill for this month is different, then record them all at once.</p>
      <ul className="grid gap-2">
        {lines.map(l => (
          <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" data-testid={`reminder-${l.label}`}>
            <span className="grid min-w-0 gap-px">
              <span className="min-w-0 text-base font-medium [overflow-wrap:anywhere]">{l.label}</span>
              <span className="text-base text-fg-2">for {monthKeyLabel(l.period)}</span>
            </span>
            <div className="w-[160px]">
              <NumberInput
                aria-label={`Amount for ${l.label}, PKR`}
                value={l.id in edits ? edits[l.id] : l.usual}
                onChange={v => setEdits(e => ({ ...e, [l.id]: v }))}
                className="text-base"
              />
            </div>
          </li>
        ))}
      </ul>
      {bad.length > 0 ? (
        <p role="alert" className="text-base text-tone-danger-fg">
          Enter an amount above zero for {bad.map(b => b.label).join(', ')}.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Check} busy={busy} busyLabel="Recording" disabled={loading || lines.length === 0 || bad.length > 0} onClick={() => void recordAll()} className={compact ? 'min-h-touch' : undefined}>
          {`Record all (PKR ${formatAmount(total)})`}
        </Button>
        <Button variant="quiet" icon={ExternalLink} onClick={() => navigate(item.href)} className={compact ? 'min-h-touch' : undefined}>
          Open Expenses
        </Button>
        <span className="flex-1" />
        <SnoozeMenu item={item} today={today} iconOnly={compact} />
      </div>
    </section>
  )
}
