import { useState } from 'react'
import { Check, Pencil, Plus, Repeat } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { RecurringDialog } from '@/features/money/expenses/RecurringDialog'
import { useRecordRecurring, useRecordedRecurring, useRecurring } from '@/features/money/expenses/hooks'
import {
  dueThisMonth,
  monthKey,
  monthKeyLabel,
  paidViaFor,
  recurringPaidOn,
  type Category,
  type RecurringTemplate,
} from '@/features/money/expenses/model'

/*
 * Recurring templates (M03): rent, salaries, internet. Each active template that has not been recorded for this month
 * shows "Record" (one tap: one expense, dated its day of the month or today, with (recurring_id, period) so it can only
 * exist once), paid the way the template says (0084), else as its category usually is. "Record all N" records every due one.
 * With none set up the panel is one line (grader: the explanation lives in the (i)). Record is a secondary button: the
 * screen's one green button is Add expenses.
 */
export function RecurringPanel({ categories, today }: { categories: readonly Category[]; today: string }) {
  const period = monthKey(today)
  const templates = useRecurring()
  const recorded = useRecordedRecurring(period)
  const record = useRecordRecurring()
  const toast = useToast()
  const [editing, setEditing] = useState<RecurringTemplate | 'new' | null>(null)
  const [recording, setRecording] = useState<string | null>(null)

  const recordedIds = new Set(recorded.data ?? [])
  const due = dueThisMonth(templates.data ?? [], recordedIds, period)
  const dueIds = new Set(due.map(d => d.id))
  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? ''
  const viaOf = (t: RecurringTemplate) => t.paidVia ?? paidViaFor(t.categoryId, categories)

  const doRecord = (t: RecurringTemplate) => {
    setRecording(t.id)
    record.mutate(
      { template: t, id: crypto.randomUUID(), period, paidOn: recurringPaidOn(t, today), paidVia: viaOf(t) },
      {
        onSuccess: () => toast.toast({ title: `Recorded ${t.label}`, body: `PKR ${t.amount.toLocaleString('en-US')} · ${monthKeyLabel(period)}`, tone: 'success' }),
        onError: e => {
          const m = mapPgError(e, { entity: 'expense' })
          // (recurring_id, period) is unique: a second press, or another tab, finds it already recorded.
          if (m.kind === 'unique') toast.toast({ title: `${t.label} is already recorded`, body: monthKeyLabel(period), tone: 'neutral' })
          else toast.toast({ title: `Couldn't record ${t.label}`, body: m.message, tone: 'danger' })
        },
        onSettled: () => setRecording(null),
      },
    )
  }

  /** Batch (entry-burden J14): every due template in one tap, one toast. One another tab already recorded is skipped. */
  const [recordingAll, setRecordingAll] = useState(false)
  const recordAll = async () => {
    setRecordingAll(true)
    let done = 0
    let total = 0
    const failed: string[] = []
    for (const t of due) {
      try {
        await record.mutateAsync({ template: t, id: crypto.randomUUID(), period, paidOn: recurringPaidOn(t, today), paidVia: viaOf(t) })
        done += 1
        total += t.amount
      } catch (e) {
        if (mapPgError(e, { entity: 'expense' }).kind !== 'unique') failed.push(t.label)
      }
    }
    setRecordingAll(false)
    if (done > 0) toast.toast({ title: `Recorded ${done} recurring ${done === 1 ? 'expense' : 'expenses'}`, body: `PKR ${total.toLocaleString('en-US')} · ${monthKeyLabel(period)}`, tone: 'success' })
    if (failed.length > 0) toast.toast({ title: `Couldn't record ${failed.join(', ')}`, body: 'Nothing else was changed. Try again.', tone: 'danger' })
  }

  const loading = templates.isPending || recorded.isPending
  const none = !loading && !templates.isError && (templates.data ?? []).length === 0
  if (none)
    return (
      <section aria-labelledby="recurring-h" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border bg-surface px-4 py-2">
        <Icon icon={Repeat} className="text-fg-muted" />
        <h2 id="recurring-h" className="text-sm font-semibold">
          Recurring
        </h2>
        <span className="text-sm text-fg-muted">none set up</span>
        <InfoTip label="About recurring expenses">
          Rent, salaries and internet that are paid every month. Add one and it shows here as due each month, ready to record in one tap. You can
          also tick Every month on a row in Add expenses.
        </InfoTip>
        <span className="flex-1" />
        <Button size="sm" variant="quiet" icon={Plus} onClick={() => setEditing('new')}>
          Add recurring
        </Button>
        {editing ? <RecurringDialog categories={categories} onClose={() => setEditing(null)} /> : null}
      </section>
    )
  return (
    <section aria-labelledby="recurring-h" className="rounded border bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h2 id="recurring-h" className="text-base font-semibold">
          Recurring
        </h2>
        <span className="text-sm text-fg-muted">
          {loading ? 'Loading' : due.length > 0 ? `${due.length} due for ${monthKeyLabel(period)}` : `All recorded for ${monthKeyLabel(period)}`}
        </span>
        <span className="flex-1" />
        {due.length > 1 ? (
          <Button size="sm" icon={Check} busy={recordingAll} busyLabel="Recording" disabled={recording !== null} onClick={() => void recordAll()}>
            {`Record all ${due.length}`}
          </Button>
        ) : null}
        <Button size="sm" variant="quiet" icon={Plus} onClick={() => setEditing('new')}>
          Add recurring
        </Button>
      </header>
      {loading ? (
        <div className="grid gap-2 p-4" aria-busy="true">
          <Skeleton className="h-8" />
        </div>
      ) : templates.isError ? (
        <p role="alert" className="p-4 text-sm text-tone-danger-fg">
          The recurring expenses could not be loaded.{' '}
          <button type="button" className="font-medium underline" onClick={() => void templates.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <ul className="divide-y">
          {(templates.data ?? []).map(t => (
            <li key={t.id} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2" data-testid={`recurring-${t.label}`}>
              {/* the name opens the template (on a phone this is the edit control; the pencil shows from sm up) */}
              <button type="button" onClick={() => setEditing(t)} className="grid min-w-0 gap-px rounded text-left">
                <span className="min-w-0 [overflow-wrap:anywhere] text-base font-medium">{t.label}</span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-sm text-fg-muted">
                  {catName(t.categoryId)}
                  {t.dayOfMonth ? ` · day ${t.dayOfMonth}` : ''} · {viaOf(t) === 'cash' ? 'cash' : 'bank'}
                  {!t.active ? ' · paused' : ''}
                </span>
              </button>
              <span className="flex items-center gap-2 sm:gap-3">
                <Money value={t.amount} prefix={false} className="text-base" />
                {dueIds.has(t.id) ? (
                  <Button
                    size="sm"
                    icon={Check}
                    busy={recording === t.id}
                    busyLabel="Recording"
                    onClick={() => doRecord(t)}
                    aria-label={`Record ${t.label}`}
                    className="max-sm:min-h-[44px]"
                  >
                    Record
                  </Button>
                ) : t.active ? (
                  <span className="inline-flex items-center gap-1 text-sm text-tone-success-fg sm:w-[96px]">
                    <Icon icon={Check} size="sm" />
                    Recorded
                  </span>
                ) : (
                  <span className="sm:w-[96px]" />
                )}
                <Button variant="quiet" size="sm" icon={Pencil} aria-label={`Edit ${t.label}`} onClick={() => setEditing(t)} className="max-sm:hidden" />
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? <RecurringDialog template={editing === 'new' ? undefined : editing} categories={categories} onClose={() => setEditing(null)} /> : null}
    </section>
  )
}
