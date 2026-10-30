import { useState } from 'react'
import { CircleCheck, FileDown, Pencil, Plus } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextArea } from '@/ui/form/TextField'
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
export function VisitsSection({ order, engineers, isEngineer, canEdit }: { order: OrderHeader; engineers: readonly PersonRow[]; isEngineer: boolean; canEdit: boolean }) {
  const session = useSession()
  const visits = useOrderVisits(order.id)
  const [editing, setEditing] = useState<VisitRow | 'new' | null>(null)
  const who = session.status === 'signed-in' ? { role: session.user.role, id: session.user.id } : { role: '', id: '' }
  const office = who.role === 'admin' || who.role === 'sales'
  const onOrder = engineers.some(e => e.id === who.id)
  const rows = visits.data ?? []
  const today = businessToday()

  return (
    <div className="grid gap-3 border-t pt-4" data-testid="visits">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">Visits</h3>
        {office && canEdit ? (
          <Button size="sm" variant="quiet" icon={Plus} className="ml-auto" onClick={() => setEditing('new')}>
            Add visit
          </Button>
        ) : null}
      </div>
      {visits.isError ? <p className="text-sm text-fg-muted">The visits did not load. Reload the page to try again.</p> : null}
      {!visits.isError && !visits.isLoading && rows.length === 0 ? <p className="text-sm text-fg-muted">No visits yet.</p> : null}
      {rows.length > 0 ? (
        <ul className="grid gap-3" aria-label="Visits on this order">
          {rows.map(v => (
            <VisitRowItem key={v.id} order={order} visit={v} state={visitState(v, today)} mayEdit={canEdit && canEditVisit(v, who, onOrder)} onEdit={() => setEditing(v)} />
          ))}
        </ul>
      ) : null}
      {editing ? <VisitEditDialog order={order} visit={editing === 'new' ? null : editing} engineers={engineers} office={office && !isEngineer} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function VisitRowItem({ order, visit, state, mayEdit, onEdit }: { order: OrderHeader; visit: VisitRow; state: VisitState; mayEdit: boolean; onEdit: () => void }) {
  const { toast } = useToast()
  const update = useUpdateVisit(order.id)
  const report = useServiceReport(order, visit)
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
  return (
    <li className="grid gap-2 rounded border bg-surface px-3 py-3" data-visit={visit.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{VISIT_TYPE_LABEL[visit.type]}</span>
        <span className={visit.on ? 'num text-sm' : 'text-sm text-fg-muted'}>{visit.on ? formatDay(visit.on) : 'No date yet'}</span>
        <span className={state === 'late' ? 'text-xs font-medium text-tone-danger-fg' : 'text-xs text-fg-muted'}>
          {state === 'done' && visit.doneOn ? `${VISIT_STATE_LABEL.done} ${formatDay(visit.doneOn)}` : VISIT_STATE_LABEL[state]}
        </span>
      </div>
      {visit.engineerName ? (
        <span className="flex items-center gap-2 text-sm">
          <Avatar name={visit.engineerName} />
          {visit.engineerName}
        </span>
      ) : null}
      {visit.notes ? <p className="whitespace-pre-wrap text-sm">{visit.notes}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {mayEdit && !visit.doneOn ? (
          <Button size="sm" icon={CircleCheck} onClick={() => void markDone()} busy={update.isPending} busyLabel="Saving">
            Mark visit done
          </Button>
        ) : null}
        {mayEdit ? (
          <Button size="sm" variant="quiet" icon={Pencil} onClick={onEdit}>
            Edit visit
          </Button>
        ) : null}
        <Button size="sm" variant="quiet" icon={FileDown} onClick={() => void report.download()} busy={report.pending} busyLabel="Preparing">
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
                  placeholder="Nobody yet"
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
