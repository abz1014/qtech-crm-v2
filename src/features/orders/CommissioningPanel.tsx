import { useState } from 'react'
import { CircleCheck, Lock, Pencil, X } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Avatar } from '@/ui/Avatar'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { Select } from '@/ui/form/Select'
import { TextArea } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, PersonRow } from '@/features/orders/api'
import { useAddEngineer, useEngineerCandidates, useRemoveEngineer, useUpdateOrder } from '@/features/orders/hooks'
import { TapDate } from '@/features/orders/TapEdit'
import { useMarkDone, useSetPlanned } from '@/features/orders/commissioningActions'

/*
 * Commissioning (O03; g2-order-detail.html "Commissioning"). Needs it, the engineers assigned, the planned date and the done date.
 *
 * A3: the engineer's work is ONE tap, "Mark done today" (nothing typed). Moving the planned date is a separate, optional action.
 * Scope, gate pass and site phone are not fields: they live in the order notes and the site contact, shown read-only to an engineer.
 */

export function CommissioningPanel({
  order,
  engineers,
  isEngineer,
  canEdit,
}: {
  order: OrderHeader
  engineers: readonly PersonRow[]
  isEngineer: boolean
  canEdit: boolean
}) {
  const { toast } = useToast()
  const today = businessToday()
  const update = useUpdateOrder(order.id)
  const markDone = useMarkDone(order)
  const setPlanned = useSetPlanned(order)
  const add = useAddEngineer(order.id)
  const remove = useRemoveEngineer(order.id)
  const candidates = useEngineerCandidates(!isEngineer && order.needsCommissioning)
  const [editingNotes, setEditingNotes] = useState(false)
  const free = (candidates.data ?? []).filter(c => !engineers.some(e => e.id === c.id))
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
  const state = order.state?.commissioning

  return (
    <section aria-label="Commissioning" className="min-w-0 rounded border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <h2 className="text-base font-semibold">Commissioning</h2>
        {state ? <StatusBadge dimension="commissioning" value={state} /> : null}
        {isEngineer ? <span className="ml-auto text-sm text-fg-muted">Nothing to type here</span> : null}
      </div>

      <div className="grid gap-5 px-5 py-4">
        {!isEngineer ? (
          <Checkbox
            label="This order needs commissioning"
            checked={order.needsCommissioning}
            disabled={!canEdit}
            onCheckedChange={v => update.mutate({ needs_commissioning: v === true }, { onError: fail('Could not save') })}
          />
        ) : null}

        {order.needsCommissioning ? (
          <div className="grid gap-5 md:grid-cols-3">
            <div className="grid content-start gap-1">
              <span className="text-xs text-fg-muted">Planned on</span>
              <TapDate value={order.plannedOn} label="Planned date" today={today} disabled={!canEdit || isEngineer} onSave={setPlanned} empty="Not planned" />
              <span className="text-xs text-fg-muted">{isEngineer ? 'Moved with “Change planned date”.' : 'Known at order time.'}</span>
            </div>
            <div className="grid content-start gap-1">
              <span className="text-xs text-fg-muted">Done on</span>
              {order.doneOn ? (
                <span className="num text-sm">{formatDay(order.doneOn)}</span>
              ) : (
                <span className="text-sm text-fg-muted">Not yet</span>
              )}
              {!order.doneOn && canEdit && !isEngineer ? (
                <Button variant="primary" icon={CircleCheck} className="justify-self-start" onClick={() => void markDone.run()} busy={markDone.pending} busyLabel="Saving">
                  Mark done today
                </Button>
              ) : (
                <span className="text-xs text-fg-muted">{order.doneOn ? '' : '“Mark done today” stamps today’s date.'}</span>
              )}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-xs text-fg-muted">Engineers</span>
              {engineers.length === 0 ? <span className="text-sm text-fg-muted">None assigned</span> : null}
              <ul className="grid gap-2" aria-label="Engineers on this order">
                {engineers.map(e => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <Avatar name={e.name} />
                    <span className="min-w-0 flex-1">{e.name}</span>
                    {!isEngineer && canEdit ? (
                      <Button size="sm" variant="quiet" icon={X} aria-label={`Remove ${e.name}`} onClick={() => remove.mutate(e.id, { onError: fail('Could not remove') })} />
                    ) : null}
                  </li>
                ))}
              </ul>
              {!isEngineer && canEdit && free.length > 0 ? (
                <Select
                  aria-label="Assign an engineer"
                  value=""
                  placeholder="Assign an engineer"
                  onChange={e => e.target.value && add.mutate(e.target.value, { onError: fail('Could not assign') })}
                  options={free.map(f => ({ value: f.id, label: f.name }))}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">This order has no commissioning.</p>
        )}

        <div className="grid gap-5 border-t pt-4 md:grid-cols-2">
          <div className="grid content-start gap-1">
            <span className="flex items-center gap-2 text-xs text-fg-muted">
              Order notes
              {isEngineer ? (
                <span className="inline-flex items-center gap-1">
                  <Icon icon={Lock} size="chip" /> Read only
                </span>
              ) : canEdit ? (
                <Button size="sm" variant="quiet" icon={Pencil} onClick={() => setEditingNotes(true)}>
                  Edit notes
                </Button>
              ) : null}
            </span>
            <p className="whitespace-pre-wrap text-sm" data-testid="order-notes">
              {order.notes ? order.notes : <span className="text-fg-muted">No notes.</span>}
            </p>
          </div>
          <div className="grid content-start gap-1">
            <span className="flex items-center gap-2 text-xs text-fg-muted">
              Site contact
              <span className="inline-flex items-center gap-1">
                <Icon icon={Lock} size="chip" /> Read only
              </span>
            </span>
            {order.contact ? (
              <p className="text-sm">
                {order.contact.name}
                {order.contact.phone ? <span className="num block text-primary">{order.contact.phone}</span> : null}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">No contact on record.</p>
            )}
          </div>
        </div>
      </div>
      {editingNotes ? <NotesDialog order={order} onClose={() => setEditingNotes(false)} /> : null}
    </section>
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
