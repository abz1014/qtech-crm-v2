import { useState } from 'react'
import { CircleCheck, FileDown, Pencil, Plus } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import type { StepTone } from '@/lib/status'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextArea } from '@/ui/form/TextField'
import { Skeleton } from '@/ui/Skeleton'
import { StatusText } from '@/ui/StatusText'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, PersonRow } from '@/features/orders/api'
import { useEngineerCandidates } from '@/features/orders/hooks'
import { VISIT_TYPES, VISIT_TYPE_LABEL } from '@/features/orders/lib/visit'
import { useCreateVisit, useDeleteVisit, useOrderVisits, useUpdateVisit } from '@/features/orders/visits/hooks'
import {
  canEditVisit,
  draftChanged,
  draftOf,
  draftPatch,
  emptyDraft,
  NOTES_MAX,
  VISIT_STATE_LABEL,
  visitState,
  type VisitDraft,
  type VisitRow,
  type VisitState,
} from '@/features/orders/visits/model'
import { useServiceReport } from '@/features/orders/visits/pdf/useServiceReport'

/*
 * The visits of an order (migration 0130): each one a type, a date (no time of day), an engineer, a few words of notes and done or not
 * done. Admin and sales add, change and remove visits; an engineer changes the ones that are theirs and marks them done. Every role can
 * download the service report of a visit (it carries no price). Nothing here is required but the type, which starts as Installation.
 */
export function VisitsSection({ order, engineers, isEngineer, canEdit, card = false }: { order: OrderHeader; engineers: readonly PersonRow[]; isEngineer: boolean; canEdit: boolean; card?: boolean }) {
  const session = useSession()
  const visits = useOrderVisits(order.id)
  const [editing, setEditing] = useState<VisitRow | 'new' | null>(null)
  const who = session.status === 'signed-in' ? { role: session.user.role, id: session.user.id } : { role: '', id: '' }
  const office = who.role === 'admin' || who.role === 'sales'
  const onOrder = engineers.some(e => e.id === who.id)
  const rows = visits.data ?? []
  const today = businessToday()

  const body = (
    <>
      {visits.isLoading ? <VisitsLoading card={card} /> : null}
      {visits.isError ? <p className={cn('type-body text-fg-muted', card ? 'pt-3' : 'border-b py-3')}>The visits did not load. Reload the page to try again.</p> : null}
      {!visits.isError && !visits.isLoading && rows.length === 0 ? <p className={cn('type-body text-fg-muted', card ? 'pt-3' : 'border-b py-3')}>No visits yet.</p> : null}
      {rows.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] p-0" aria-label="Visits on this order">
          {rows.map(v => (
            <VisitRowItem key={v.id} order={order} visit={v} state={visitState(v, today)} mayEdit={canEdit && canEditVisit(v, who, onOrder)} onEdit={() => setEditing(v)} card={card} />
          ))}
        </ul>
      ) : null}
      {editing ? <VisitEditDialog order={order} visit={editing === 'new' ? null : editing} engineers={engineers} office={office && !isEngineer} onClose={() => setEditing(null)} /> : null}
    </>
  )

  // card: the engineer's job page draws it as its own Forest card (43-job-delivery #e-visits), like Contact and Delivery challans, with
  // phone-sized buttons. Inside the office's Commissioning row it stays a plain section under its own small heading (#dv-commissioning).
  if (card) {
    return (
      <section aria-label="Visits" className={cn(CARD, 'min-w-0 p-card')} data-testid="visits">
        <h2 className="type-section">Visits</h2>
        {body}
      </section>
    )
  }
  return (
    <section className="min-w-0" data-testid="visits">
      <div className="flex min-h-control flex-wrap items-center gap-x-3 gap-y-2 border-b py-2">
        <h3 className="type-row">Visits</h3>
        {office && canEdit ? (
          <Button size="sm" variant="quiet" icon={Plus} className="ml-auto" onClick={() => setEditing('new')}>
            Add visit
          </Button>
        ) : null}
      </div>
      {body}
    </section>
  )
}

/** Two rows shaped like a visit (type, day, state; the engineer; the buttons) while the list loads. */
function VisitsLoading({ card }: { card: boolean }) {
  return (
    <div className="grid" role="status" aria-label="Loading visits">
      {[0, 1].map(n => (
        <div key={n} className={cn('grid gap-3 py-3', (!card || n === 0) && 'border-b')}>
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-[6rem]" />
            <Skeleton className="h-4 w-[5rem]" />
            <Skeleton className="h-4 w-[4rem]" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-pill" />
            <Skeleton className="h-3 w-[7rem]" />
          </div>
          <div className="flex gap-2">
            <Skeleton className={cn('w-[7rem]', card ? 'h-control' : 'h-control-sm')} />
            <Skeleton className={cn('w-[7rem]', card ? 'h-control' : 'h-control-sm')} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The state as the Forest status (an icon and a word in the tone's ink): Done with its day, Planned, Late, No date yet. */
const STATE_TONE: Record<VisitState, StepTone> = { done: 'done', planned: 'waiting', late: 'late', unplanned: 'inert' }

function VisitRowItem({ order, visit, state, mayEdit, onEdit, card }: { order: OrderHeader; visit: VisitRow; state: VisitState; mayEdit: boolean; onEdit: () => void; card: boolean }) {
  const { toast } = useToast()
  const update = useUpdateVisit(order.id)
  const report = useServiceReport(order, visit)
  // the buttons repeat on every row, so each one's name says which visit it is for ("Edit visit: Survey Tue 20 Oct")
  const which = `${VISIT_TYPE_LABEL[visit.type]}${visit.on ? ` ${formatDay(visit.on)}` : ''}`
  const markDone = async () => {
    try {
      await update.mutateAsync({ id: visit.id, patch: { done_on: businessToday() } })
      toast({
        title: 'Visit marked done',
        body: `${VISIT_TYPE_LABEL[visit.type]}, ${order.companyName}`,
        undo: {
          onUndo: async () => {
            await update.mutateAsync({ id: visit.id, patch: { done_on: null } })
          },
          settledTitle: 'Visit marked done',
          undoneTitle: 'Taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not mark it done', body: mapPgError(err, { entity: 'visit' }).message, tone: 'danger' })
    }
  }
  const canMark = mayEdit && !visit.doneOn
  // an engineer's phone: 48 px buttons that grow to fill the line and wrap whole when two do not fit (320 px: one to a line)
  const size = card ? 'md' : 'sm'
  const btn = card ? 'max-md:h-control-lg max-md:flex-[1_1_auto]' : undefined
  return (
    <li className={cn('grid min-w-0 gap-2 border-b py-3', card && 'last:border-b-0 last:pb-0')} data-visit={visit.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-card text-base">{VISIT_TYPE_LABEL[visit.type]}</span>
        <span className={visit.on ? 'num text-sm text-fg-2' : 'text-sm text-fg-muted'}>{visit.on ? formatDay(visit.on) : 'No date yet'}</span>
        {state === 'unplanned' ? null : (
          <StatusText tone={STATE_TONE[state]}>{state === 'done' && visit.doneOn ? `${VISIT_STATE_LABEL.done} ${formatDay(visit.doneOn)}` : VISIT_STATE_LABEL[state]}</StatusText>
        )}
      </div>
      {visit.engineerName ? (
        <span className="flex min-w-0 items-center gap-2 text-sm text-fg-2">
          <Avatar name={visit.engineerName} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{visit.engineerName}</span>
        </span>
      ) : null}
      {visit.notes ? <p className="m-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{visit.notes}</p> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {canMark ? (
          <Button size={size} icon={CircleCheck} className={btn} onClick={() => void markDone()} busy={update.isPending} busyLabel="Saving" aria-label={`Mark visit done: ${which}`}>
            Mark visit done
          </Button>
        ) : null}
        {mayEdit ? (
          <Button size={size} icon={Pencil} className={btn} onClick={onEdit} aria-label={`Edit visit: ${which}`}>
            Edit visit
          </Button>
        ) : null}
        <Button size={size} icon={FileDown} className={btn} onClick={() => void report.download()} busy={report.pending} busyLabel="Preparing" aria-label={`Service report: ${which}`}>
          Service report
        </Button>
      </div>
    </li>
  )
}

function VisitEditDialog({ order, visit, engineers, office, onClose }: { order: OrderHeader; visit: VisitRow | null; engineers: readonly PersonRow[]; office: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreateVisit(order.id)
  const update = useUpdateVisit(order.id)
  const remove = useDeleteVisit(order.id)
  const candidates = useEngineerCandidates(office)
  const start = visit ? draftOf(visit) : emptyDraft()
  const [draft, setDraft] = useState<VisitDraft>(start)
  const [confirming, setConfirming] = useState(false)
  const pending = create.isPending || update.isPending
  const changed = visit ? draftChanged(draft, start) : true

  // who can do the visit: the engineers on the order, every active engineer, and whoever it is already for
  const people = new Map<string, string>()
  for (const p of engineers) people.set(p.id, p.name)
  for (const p of candidates.data ?? []) people.set(p.id, p.name)
  if (visit?.engineerId && visit.engineerName) people.set(visit.engineerId, visit.engineerName)

  const save = async () => {
    try {
      if (visit) {
        // an engineer cannot change who the visit is for, so that column is left out of what they send
        const patch = draftPatch(draft)
        await update.mutateAsync({ id: visit.id, patch: office ? patch : { visit_type: patch.visit_type, visit_on: patch.visit_on, notes: patch.notes } })
      } else {
        await create.mutateAsync(draft)
      }
      onClose()
    } catch (err) {
      toast({ title: 'Could not save the visit', body: mapPgError(err, { entity: 'visit' }).message, tone: 'danger' })
    }
  }

  return (
    <>
      <Dialog open busy={pending} onOpenChange={o => (o ? null : onClose())}>
        <DialogContent
          title={visit ? 'Visit' : 'Add a visit'}
          context="A visit has a type and a day, no time. Only the type is needed."
          footer={
            <>
              {visit && office ? (
                <Button variant="quiet" className="mr-auto" onClick={() => setConfirming(true)} disabled={pending}>
                  Delete visit
                </Button>
              ) : null}
              <Button data-cancel onClick={onClose} disabled={pending}>
                {changed ? 'Cancel' : 'Close'}
              </Button>
              <Button variant="primary" busy={pending} busyLabel="Saving" disabled={!changed} onClick={() => void save()}>
                Save
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label="Visit type" requirement="required">
              <Select
                value={draft.type}
                onChange={e => setDraft({ ...draft, type: e.target.value as VisitDraft['type'] })}
                options={VISIT_TYPES.map(t => ({ value: t, label: VISIT_TYPE_LABEL[t] }))}
              />
            </Field>
            <Field label="Date" requirement="optional">
              <DateInput value={draft.on} onChange={on => setDraft({ ...draft, on })} defaultToday={false} />
            </Field>
            {office ? (
              <Field label="Engineer" requirement="optional">
                <Select
                  value={draft.engineerId}
                  placeholder="None assigned"
                  onChange={e => setDraft({ ...draft, engineerId: e.target.value })}
                  options={[...people].map(([value, label]) => ({ value, label }))}
                />
              </Field>
            ) : null}
            <Field label="Notes" requirement="optional" help="Gate pass, who to ask for, what was done.">
              <TextArea rows={4} maxLength={NOTES_MAX} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
          </div>
        </DialogContent>
      </Dialog>
      {visit ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          thing="this visit"
          summary={`${VISIT_TYPE_LABEL[visit.type]}${visit.on ? ` on ${formatDay(visit.on)}` : ''}`}
          onConfirm={async () => {
            await remove.mutateAsync(visit.id)
            onClose()
          }}
        />
      ) : null}
    </>
  )
}
