import { useState } from 'react'
import { Tag } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { useToast } from '@/ui/useToast'
import type { OrderHeader } from '@/features/orders/api'
import { useUpdateOrder } from '@/features/orders/hooks'
import { DEFAULT_VISIT_TYPE, VISIT_TYPES, VISIT_TYPE_LABEL, visitChanged, visitPatch, type VisitValue } from '@/features/orders/lib/visit'

/*
 * The visit's type (redesign phase 7; migrations 0101 and 0109; owner answer to Q6: installation, survey or service; a visit has a date
 * and no time of day). Admin and sales set it in the commissioning plan dialog (VisitFields); the engineer assigned to the site sets it
 * from "Visit type" on their job. Someone who is not assigned is refused by the server (hint not_assigned) and the dialog says so in
 * plain words.
 */

export function VisitFields({ value, onChange }: { value: VisitValue; onChange: (v: VisitValue) => void }) {
  return (
    <Field label="Visit type" requirement="required" help="What the engineer is going for. Installation unless you pick another.">
      <Select
        value={value.type}
        onChange={e => onChange({ ...value, type: e.target.value })}
        options={VISIT_TYPES.map(t => ({ value: t, label: VISIT_TYPE_LABEL[t] }))}
      />
    </Field>
  )
}

/** The engineer's button and its small dialog. Saves on its own (nothing else on the order is touched). */
export function VisitButton({ order, className }: { order: OrderHeader; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button icon={Tag} className={className} onClick={() => setOpen(true)}>
        Visit type
      </Button>
      {open ? <VisitDialog order={order} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function VisitDialog({ order, onClose }: { order: OrderHeader; onClose: () => void }) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id, order.updatedAt)
  const start: VisitValue = { type: order.visitType ?? DEFAULT_VISIT_TYPE }
  const [value, setValue] = useState<VisitValue>(start)
  const [refused, setRefused] = useState<string | null>(null)
  const changed = visitChanged(value, start)

  const save = async () => {
    setRefused(null)
    try {
      await update.mutateAsync(visitPatch(value))
      toast({ title: 'Visit type saved', body: order.companyName })
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
        title="Visit type"
        context="What kind of visit it is: an installation, a survey or a service."
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
