import { useState } from 'react'
import { Clock } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { OrderHeader } from '@/features/orders/api'
import { useUpdateOrder } from '@/features/orders/hooks'
import { VISIT_TYPES, VISIT_TYPE_LABEL, visitChanged, visitPatch, visitValueOf, type VisitValue } from '@/features/orders/lib/visit'

/*
 * The visit's time and type (redesign phase 7; migration 0101; owner-question Q6: installation, survey or service, the time optional).
 * Admin and sales set them in the commissioning plan dialog (VisitFields); the engineer assigned to the site sets them from "Visit time
 * and type" on their job. Someone who is not assigned is refused by the server (hint not_assigned) and the dialog says so in plain words.
 */

export function VisitFields({ value, onChange }: { value: VisitValue; onChange: (v: VisitValue) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Visit type" requirement="optional">
        <Select
          value={value.type}
          placeholder="Not set"
          onChange={e => onChange({ ...value, type: e.target.value })}
          options={VISIT_TYPES.map(t => ({ value: t, label: VISIT_TYPE_LABEL[t] }))}
        />
      </Field>
      <Field label="Visit time" requirement="optional">
        <TextField type="time" step={60} value={value.time} onChange={e => onChange({ ...value, time: e.target.value })} />
      </Field>
    </div>
  )
}

/** The engineer's button and its small dialog. Saves on its own (nothing else on the order is touched). */
export function VisitButton({ order, className }: { order: OrderHeader; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button icon={Clock} className={className} onClick={() => setOpen(true)}>
        Visit time and type
      </Button>
      {open ? <VisitDialog order={order} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function VisitDialog({ order, onClose }: { order: OrderHeader; onClose: () => void }) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id)
  const start = visitValueOf(order)
  const [value, setValue] = useState<VisitValue>(start)
  const [refused, setRefused] = useState<string | null>(null)
  const changed = visitChanged(value, start)

  const save = async () => {
    setRefused(null)
    try {
      await update.mutateAsync(visitPatch(value))
      toast({ title: 'Visit saved', body: order.companyName })
      onClose()
    } catch (err) {
      const mapped = mapPgError(err, { entity: 'order' })
      if (mapped.hint === 'not_assigned') setRefused(mapped.message)
      else toast({ title: 'Could not save', body: mapped.message, tone: 'danger' })
    }
  }

  return (
    <Dialog open busy={update.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="sm"
        title="Visit time and type"
        context="What kind of visit it is and when you will be there. The time is optional."
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
          <VisitFields value={value} onChange={setValue} />
          {refused ? (
            <p role="alert" className="text-base text-tone-danger-fg">
              {refused}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
