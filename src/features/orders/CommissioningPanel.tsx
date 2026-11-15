import { useState } from 'react'
import { CircleCheck, HardHat, Lock, NotebookPen, Pencil, X } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextArea } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, PersonRow } from '@/features/orders/api'
import { useAddEngineer, useEngineerCandidates, useRemoveEngineer, useUpdateOrder } from '@/features/orders/hooks'
import { useMarkDone } from '@/features/orders/commissioningActions'
import { VisitFields } from '@/features/orders/VisitDialog'
import { VisitsSection } from '@/features/orders/visits/VisitsSection'
import { DEFAULT_VISIT_TYPE, visitPatch, visitTypeLabel, type VisitValue } from '@/features/orders/lib/visit'

/*
 * Commissioning (O03; g2-order-detail.html "Commissioning"): planned on, done on, the engineers, and the order notes and site contact.
 * Admin and sales have an Edit button (needs-it, planned date, engineers) and a secondary "Mark done today" (the page's one green button
 * is in the header: when that is "Mark done today" it is not repeated here). An engineer has no button here and works from "Your job" at
 * the top of the page: "Mark done today" (1 tap, nothing typed) and "Change planned date".
 *
 * A3: scope, gate pass and site phone are not fields; they live in the order notes and the site contact, shown to an engineer, who can add a note (On site card) but not edit.
 */
/** What an engineer is told under Order notes: they cannot edit the order's notes, but they can add a line from the On site card. */
export const ENGINEER_NOTES_HINT = 'Add a note with Add photo or note'

export function CommissioningPanel({
  order,
  engineers,
  isEngineer,
  canEdit,
  markDoneAbove = false,
  inFold = false,
}: {
  order: OrderHeader
  engineers: readonly PersonRow[]
  isEngineer: boolean
  canEdit: boolean
  /** The header's primary button is already "Mark done today". */
  markDoneAbove?: boolean
  /** Drawn inside a FoldRow that already carries the name "Commissioning" (the job page's Delivery step): no region of its own. */
  inFold?: boolean
}) {
  const markDone = useMarkDone(order)
  const [editing, setEditing] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  // One hairline row per fact: the name at the left, the value at the right (clarity redesign: no box, no box in a box).
  const row = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2 type-body'
  const dim = 'text-fg-muted'
  const Wrap = inFold ? 'div' : 'section'
  // Forest (43-job-delivery #dv-commissioning): Edit at the right of the body, hairline fact rows, the last row without its line.

  return (
    <Wrap aria-label={inFold ? undefined : 'Commissioning'} className="min-w-0 [&>dl:last-of-type>div:last-child]:border-b-0">
      {!inFold || (!isEngineer && canEdit) ? (
        <div className={cn('flex flex-wrap items-center gap-3', inFold ? 'justify-end pb-1' : 'border-b py-2')}>
          {inFold ? null : <h2 className="type-section">Commissioning</h2>}
          {/* no state chip: the status strip above already says it (consistency spec 1.5) */}
          {!isEngineer && canEdit ? (
            <Button size="md" variant="quiet" icon={Pencil} className="ml-auto" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
        </div>
      ) : null}

      {order.needsCommissioning ? (
        <dl className="m-0">
          <div className={row}>
            <dt className="text-fg-2">Planned on</dt>
            <dd className={cn('m-0', order.plannedOn ? 'num' : dim)}>{order.plannedOn ? formatDay(order.plannedOn) : 'Not planned'}</dd>
          </div>
          <div className={row}>
            <dt className="text-fg-2">Visit type</dt>
            <dd className={cn('m-0', !order.visitType && dim)} data-testid="visit-line">
              {visitTypeLabel(order.visitType) || 'Not set'}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-fg-2">Done on</dt>
            <dd className={cn('m-0', order.doneOn ? 'num' : dim)}>{order.doneOn ? formatDay(order.doneOn) : 'Not yet'}</dd>
          </div>
          <div className={row}>
            <dt className="text-fg-2">Engineers</dt>
            <dd className="m-0 min-w-0 text-right [overflow-wrap:anywhere]">
              {engineers.length === 0 ? (
                <span className={dim}>None assigned</span>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0" aria-label="Engineers on this order">
                  {engineers.map(e => (
                    <li key={e.id} className="flex items-center justify-end gap-2">
                      <Avatar name={e.name} />
                      <span className="min-w-0">{e.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className={cn('border-b py-2 type-body', dim)}>Supply only, no commissioning.</p>
      )}
      {order.needsCommissioning && !order.doneOn && canEdit && !isEngineer && !markDoneAbove ? (
        <div className="border-b py-3">
          <Button size="md" icon={CircleCheck} onClick={markDone.run} busy={markDone.pending} busyLabel="Saving">
            Mark done today
          </Button>
        </div>
      ) : null}

      {order.needsCommissioning ? <VisitsSection order={order} engineers={engineers} isEngineer={isEngineer} canEdit={canEdit} /> : null}

      <dl className="m-0">
        <div className={row}>
          <dt className="flex items-center gap-2 text-fg-2">
            Order notes
            {isEngineer ? (
              <span className="inline-flex items-center gap-1">
                <Icon icon={Lock} size="chip" /> {ENGINEER_NOTES_HINT}
              </span>
            ) : canEdit ? (
              <Button size="sm" variant="quiet" icon={Pencil} onClick={() => setEditingNotes(true)}>
                Edit notes
              </Button>
            ) : null}
          </dt>
          <dd className="m-0 min-w-0 basis-full whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="order-notes">
            {order.notes ? order.notes : <span className={dim}>None</span>}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-fg-2">Site contact</dt>
          <dd className="m-0 text-right">
            {order.contact ? (
              <>
                {order.contact.name}
                {order.contact.phone ? <span className="num block text-primary">{order.contact.phone}</span> : null}
              </>
            ) : (
              <span className={dim}>None</span>
            )}
          </dd>
        </div>
      </dl>
      {editing ? <CommissioningEditDialog order={order} engineers={engineers} onClose={() => setEditing(false)} /> : null}
      {editingNotes ? <NotesDialog order={order} onClose={() => setEditingNotes(false)} /> : null}
    </Wrap>
  )
}

/** Needs it, the planned date and the engineers. Engineers are added and removed at once; the rest saves with the button. */
export function CommissioningEditDialog({ order, engineers, onClose }: { order: OrderHeader; engineers: readonly PersonRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id, order.updatedAt)
  const add = useAddEngineer(order.id)
  const remove = useRemoveEngineer(order.id)
  const candidates = useEngineerCandidates(true)
  const [needs, setNeeds] = useState(order.needsCommissioning)
  const [planned, setPlanned] = useState(order.plannedOn ?? '')
  // a visit is an installation unless someone says survey or service; the database files the same default (0109)
  const storedType = order.visitType ?? DEFAULT_VISIT_TYPE
  const [visit, setVisit] = useState<VisitValue>({ type: storedType })
  const free = (candidates.data ?? []).filter(c => !engineers.some(e => e.id === c.id))
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
  // a planned visit with no type on file is saved with the default, so the order always says what the visit is
  const typeChanged = needs && (visit.type !== storedType || (planned !== '' && order.visitType === null))
  const changed = needs !== order.needsCommissioning || (planned || null) !== order.plannedOn || typeChanged

  const save = async () => {
    try {
      await update.mutateAsync({
        needs_commissioning: needs,
        commissioning_planned_on: needs ? planned || null : order.plannedOn,
        ...(typeChanged ? visitPatch(visit) : {}),
      })
      onClose()
    } catch (err) {
      fail('Could not save')(err)
    }
  }

  return (
    <Dialog open busy={update.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        icon={HardHat}
        title="Commissioning"
        context="Mark it done from the page."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={update.isPending}>
              {changed ? 'Cancel' : 'Close'}
            </Button>
            <Button variant="primary" busy={update.isPending} busyLabel="Saving" disabled={!changed} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Checkbox label="This order needs commissioning" checked={needs} onCheckedChange={v => setNeeds(v === true)} />
          {needs ? (
            <>
              <Field label="Planned on" requirement="optional">
                <DateInput value={planned} onChange={setPlanned} defaultToday={false} />
              </Field>
              <VisitFields value={visit} onChange={setVisit} />
              <div className="grid gap-2">
                <span className="text-sm font-medium">Engineers</span>
                {engineers.length === 0 ? <span className="text-sm text-fg-muted">None assigned</span> : null}
                <ul className="grid gap-2" aria-label="Engineers on this order, editable">
                  {engineers.map(e => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <Avatar name={e.name} />
                      <span className="min-w-0 flex-1">{e.name}</span>
                      <Button size="sm" variant="quiet" icon={X} aria-label={`Remove ${e.name}`} onClick={() => remove.mutate(e.id, { onError: fail('Could not remove') })} />
                    </li>
                  ))}
                </ul>
                {free.length > 0 ? (
                  <Select
                    aria-label="Assign an engineer"
                    value=""
                    placeholder="Assign an engineer"
                    onChange={e => e.target.value && add.mutate(e.target.value, { onError: fail('Could not assign') })}
                    options={free.map(f => ({ value: f.id, label: f.name }))}
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NotesDialog({ order, onClose }: { order: OrderHeader; onClose: () => void }) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id, order.updatedAt)
  const [text, setText] = useState(order.notes ?? '')
  const save = async () => {
    try {
      await update.mutateAsync({ notes: text.trim() || null })
      onClose()
    } catch (err) {
      toast({ title: 'Could not save the notes', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }
  return (
    <Dialog open busy={update.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        icon={NotebookPen}
        title="Order notes"
        context="Scope, gate pass and anything the engineer should know. Engineers see this read only."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={update.isPending} busyLabel="Saving" onClick={() => void save()}>
              Save notes
            </Button>
          </>
        }
      >
        <TextArea aria-label="Order notes" rows={6} value={text} onChange={e => setText(e.target.value)} />
      </DialogContent>
    </Dialog>
  )
}

