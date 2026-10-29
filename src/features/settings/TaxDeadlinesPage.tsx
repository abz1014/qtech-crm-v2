import { useState } from 'react'
import { Lock, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { monthKeyLabel, shiftMonth } from '@/features/money/expenses/model'
import { dayWords, gstDatesFor, parseGstDay, type GstDeadlines } from '@/features/settings/gstDeadlines'
import { useDeleteGstOverride, useGstDeadlines, useSaveGstDays, useSaveGstOverride } from '@/features/settings/hooks'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { PageHeader } from '@/ui/PageHeader'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'

/*
 * Settings > Tax deadlines (migration 0110; owner answer to Q8). The day GST is paid to FBR and the day the return is filed are not
 * fixed, so the admin edits them here: "pay by day N of the following month", "file the return by day N" (15 and 18 to start with),
 * and a one-off date for one month's GST when FBR moves a deadline. Sales can read the page; an engineer has no GST pages at all.
 * The Today list, the GST to FBR page and the invoice warning all read these settings.
 */
export function TaxDeadlinesPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useGstDeadlines()
  return (
    <div className="grid content-start gap-4">
      <PageHeader
        title="Tax deadlines"
        lede={
          isAdmin
            ? 'The days GST is paid to FBR and the return is filed. They are not the same every year, so change them here when they change.'
            : 'The days GST is paid to FBR and the return is filed. Only an admin can change them.'
        }
        secondary={
          !isAdmin ? (
            <span className="inline-flex h-6 items-center gap-[6px] rounded bg-selected px-[6px] text-sm font-medium text-fg-2">
              <Icon icon={Lock} size="sm" />
              Only an admin can edit
            </span>
          ) : undefined
        }
      />
      {q.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading the tax deadlines" className="grid gap-4">
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[120px]" />
        </div>
      ) : q.isError ? (
        <EmptyState mood="error" title="Could not load the tax deadlines" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
          Nothing has changed. Check your connection, then try again.
        </EmptyState>
      ) : (
        <>
          <DaysSection deadlines={q.deadlines} isAdmin={isAdmin} />
          <OverridesSection deadlines={q.deadlines} isAdmin={isAdmin} />
        </>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-panel border bg-surface p-5">
      <div className="grid gap-[2px]">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="max-w-[62ch] text-sm text-fg-muted text-pretty">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function DaysSection({ deadlines, isAdmin }: { deadlines: GstDeadlines; isAdmin: boolean }) {
  const { toast } = useToast()
  const save = useSaveGstDays()
  const [pay, setPay] = useState(String(deadlines.payDay))
  const [ret, setRet] = useState(String(deadlines.returnDay))
  const payDay = parseGstDay(pay)
  const returnDay = parseGstDay(ret)
  const changed = payDay !== deadlines.payDay || returnDay !== deadlines.returnDay
  const ok = payDay !== null && returnDay !== null

  const submit = async () => {
    if (payDay === null || returnDay === null) return
    try {
      await save.mutateAsync({ payDay, returnDay })
      toast({ title: 'Tax deadlines saved', body: `Pay by the ${dayWords(payDay)}, file by the ${dayWords(returnDay)}` })
    } catch (err) {
      toast({ title: 'Could not save', body: mapPgError(err, { entity: 'tax deadline' }).message, tone: 'danger' })
    }
  }

  return (
    <Section title="Usual days" hint="Every month's GST uses these days of the following month, unless you set a one-off date below. Days 1 to 28.">
      {isAdmin ? (
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pay GST to FBR by day" requirement="required" help="Of the following month." error={payDay === null ? 'Enter a day from 1 to 28' : undefined}>
              <TextField inputMode="numeric" maxLength={2} value={pay} onChange={e => setPay(e.target.value)} />
            </Field>
            <Field label="File the return by day" requirement="required" help="Of the following month." error={returnDay === null ? 'Enter a day from 1 to 28' : undefined}>
              <TextField inputMode="numeric" maxLength={2} value={ret} onChange={e => setRet(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving" disabled={!ok || !changed}>
              Save days
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-sm text-fg-muted">Pay GST to FBR by</dt>
            <dd className="text-base" data-testid="read-pay-day">
              the {dayWords(deadlines.payDay)} of the following month
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-sm text-fg-muted">File the return by</dt>
            <dd className="text-base" data-testid="read-return-day">
              the {dayWords(deadlines.returnDay)} of the following month
            </dd>
          </div>
        </dl>
      )}
    </Section>
  )
}

/** The GST months one can move: the last twelve and this one (the GST of a month is paid the month after). */
function monthChoices(today: string): { value: string; label: string }[] {
  const now = today.slice(0, 7)
  return Array.from({ length: 13 }, (_, i) => shiftMonth(now, -i)).map(m => ({ value: `${m}-01`, label: monthKeyLabel(m) }))
}

function OverridesSection({ deadlines, isAdmin }: { deadlines: GstDeadlines; isAdmin: boolean }) {
  const { toast } = useToast()
  const save = useSaveGstOverride()
  const remove = useDeleteGstOverride()
  const choices = monthChoices(businessToday())
  const [month, setMonth] = useState(choices[1]?.value ?? choices[0].value)
  const [payBy, setPayBy] = useState('')
  const [returnBy, setReturnBy] = useState('')
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'tax deadline' }).message, tone: 'danger' })
  const usual = gstDatesFor({ ...deadlines, overrides: [] }, month)
  const canAdd = payBy !== '' || returnBy !== ''

  const add = async () => {
    try {
      await save.mutateAsync({ month, payBy: payBy || null, returnBy: returnBy || null })
      toast({ title: 'One-off date saved', body: monthKeyLabel(month.slice(0, 7)) })
      setPayBy('')
      setReturnBy('')
    } catch (err) {
      fail('Could not save')(err)
    }
  }

  return (
    <Section title="One-off dates" hint="When FBR moves a deadline for one month, set the new date here. Leave a date empty to keep the usual day.">
      {deadlines.overrides.length === 0 ? (
        <p className="text-base text-fg-muted" data-testid="no-overrides">
          No one-off dates. Every month uses the usual days.
        </p>
      ) : (
        <ul className="grid gap-2" aria-label="One-off dates" data-testid="overrides">
          {deadlines.overrides.map(o => {
            const d = gstDatesFor(deadlines, o.month)
            return (
              <li key={o.month} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-row border px-4 py-3 text-base">
                <span className="font-medium">GST for {monthKeyLabel(o.month.slice(0, 7))}</span>
                <span>Pay by {formatDay(d.payBy)}{d.payOverridden ? '' : ' (usual day)'}</span>
                <span>Return by {formatDay(d.returnBy)}{d.returnOverridden ? '' : ' (usual day)'}</span>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={Trash2}
                    className="ml-auto"
                    aria-label={`Remove the one-off date for ${monthKeyLabel(o.month.slice(0, 7))}`}
                    busy={remove.isPending && remove.variables === o.month}
                    onClick={() => remove.mutate(o.month, { onError: fail('Could not remove') })}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {isAdmin ? (
        <form
          className="grid gap-4 border-t pt-4"
          onSubmit={e => {
            e.preventDefault()
            void add()
          }}
        >
          <Field label="GST for the month of" requirement="required" help={`Usual: pay by ${formatDay(usual.payBy)}, return by ${formatDay(usual.returnBy)}.`}>
            <Select aria-label="GST for the month of" value={month} onChange={e => setMonth(e.target.value)} options={choices} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New pay-by date" requirement="optional">
              <DateInput value={payBy} onChange={setPayBy} defaultToday={false} />
            </Field>
            <Field label="New return date" requirement="optional">
              <DateInput value={returnBy} onChange={setReturnBy} defaultToday={false} />
            </Field>
          </div>
          <div>
            <Button type="submit" busy={save.isPending} busyLabel="Saving" disabled={!canAdd}>
              Save one-off date
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  )
}
