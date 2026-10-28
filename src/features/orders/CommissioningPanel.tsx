import { useState } from 'react'
import { CircleCheck, Lock, Pencil, X } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
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
import { VISIT_TYPE_LABEL, isVisitType, visitChanged, visitPatch, visitValueOf, type VisitValue } from '@/features/orders/lib/visit'

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
}: {
  order: OrderHeader
  engineers: readonly PersonRow[]
  isEngineer: boolean
  canEdit: boolean
  /** The header's primary button is already "Mark done today". */
  markDoneAbove?: boolean
}) {
  const markDone = useMarkDone(order)
  const [editing, setEditing] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)

  return (
    <section aria-label="Commissioning" className="min-w-0 rounded-panel border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-5">
        <h2 className="text-base font-semibold">Commissioning</h2>
        {/* no state chip: the status strip above already says it (consistency spec 1.5) */}
        {!isEngineer && canEdit ? (
          <Button size="sm" variant="quiet" icon={Pencil} className="ml-auto" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>

      <div className="grid gap-5 px-4 py-4 md:px-5">
        {order.needsCommissioning ? (
          <div className="grid gap-5 md:grid-cols-4">
            <div className="grid content-start gap-1">
              <span className="text-xs text-fg-muted">Planned on</span>
              <span className={order.plannedOn ? 'num text-sm' : 'text-sm text-fg-muted'}>{order.plannedOn ? formatDay(order.plannedOn) : 'Not planned'}</span>
            </div>
            <div className="grid content-start gap-1">
              <span className="text-xs text-fg-muted">Visit</span>
              <span className={order.visitTime || order.visitType ? 'text-sm' : 'text-sm text-fg-muted'} data-testid="visit-line">
                {order.visitTime || order.visitType
                  ? [order.visitTime, isVisitType(order.visitType) ? VISIT_TYPE_LABEL[order.visitType] : null].filter(Boolean).join(' · ')
                  : 'Time and type not set'}
              </span>
            </div>
            <div className="grid content-start gap-1">
              <span className="text-xs text-fg-muted">Done on</span>
              <span className={order.doneOn ? 'num text-sm' : 'text-sm text-fg-muted'}>{order.doneOn ? formatDay(order.doneOn) : 'Not yet'}</span>
              {!order.doneOn && canEdit && !isEngineer && !markDoneAbove ? (
                <Button size="sm" icon={CircleCheck} className="mt-1 justify-self-start" onClick={markDone.run} busy={markDone.pending} busyLabel="Saving">
                  Mark done today
                </Button>
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-xs text-fg-muted">Engineers</span>
              {engineers.length === 0 ? <span className="text-sm text-fg-muted">None assigned</span> : null}
              <ul className="grid gap-2" aria-label="Engineers on this order">
                {engineers.map(e => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <Avatar name={e.name} />
                    <span className="min-w-0 flex-1">{e.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Supply only, no commissioning.</p>
        )}

        <div className="grid gap-5 border-t pt-4 md:grid-cols-2">
          <div className="grid content-start gap-1">
            <span className="flex items-center gap-2 text-xs text-fg-muted">
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
            </span>
            <p className="whitespace-pre-wrap text-sm" data-testid="order-notes">
              {order.notes ? order.notes : <span className="text-fg-muted">None</span>}
            </p>
          </div>
          <div className="grid content-start gap-1">
            <span className="flex items-center gap-2 text-xs text-fg-muted">
              Site contact
            </span>
            {order.contact ? (
              <p className="text-sm">
                {order.contact.name}
                {order.contact.phone ? <span className="num block text-primary">{order.contact.phone}</span> : null}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">None</p>
            )}
          </div>
        </div>
      </div>
      {editing ? <CommissioningEditDialog order={order} engineers={engineers} onClose={() => setEditing(false)} /> : null}
      {editingNotes ? <NotesDialog order={order} onClose={() => setEditingNotes(false)} /> : null}
    </section>
  )
}

/** Needs it, the planned date and the engineers. Engineers are added and removed at once; the rest saves with the button. */
export function CommissioningEditDialog({ order, engineers, onClose }: { order: OrderHeader; engineers: readonly PersonRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id)
  const add = useAddEngineer(order.id)
  const remove = useRemoveEngineer(order.id)
  const candidates = useEngineerCandidates(true)
  const [needs, setNeeds] = useState(order.needsCommissioning)
  const [planned, setPlanned] = useState(order.plannedOn ?? '')
  const startVisit = visitValueOf(order)
  const [visit, setVisit] = useState<VisitValue>(startVisit)
  const free = (candidates.data ?? []).filter(c => !engineers.some(e => e.id === c.id))
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
  const changed = needs !== order.needsCommissioning || (planned || null) !== order.plannedOn || (needs && visitChanged(visit, startVisit))

  const save = async () => {
    try {
      await update.mutateAsync({
        needs_commissioning: needs,
        commissioning_planned_on: needs ? planned || null : order.plannedOn,
        ...(needs && visitChanged(visit, startVisit) ? visitPatch(visit) : {}),
      })
      onClose()
    } catch (err) {
      fail('Could not save')(err)
    }
  }

  return (
    <Dialog open busy={update.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Commissioning"
        context="Mark it done with one tap on the page."
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
  const update = useUpdateOrder(order.id)
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

