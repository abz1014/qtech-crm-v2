import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { RfqHeader } from '@/features/rfqs/api'
import { useAddRfqItem } from '@/features/rfqs/hooks'

/*
 * Add item (g2-rfq-detail, "Add item" in the Items panel header): one more item on an RFQ that already exists.
 *
 * FE-2 entry burden: required = the description. Pre-filled = quantity 1 (and GST 18 % from the table). Optional = unit.
 * The id is made when the dialog opens, so a double tap or a retry can only ever add the same item once.
 */
export function AddItemDialog({ rfq, onClose }: { rfq: RfqHeader; onClose: () => void }) {
  const { toast } = useToast()
  const add = useAddRfqItem(rfq.id)
  const id = useRef(crypto.randomUUID())
  const sending = useRef(false)
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState<number | null>(1)
  const [unit, setUnit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const invalid = description.trim() === ''

  const submit = async () => {
    if (invalid) {
      setError('Describe the item, for example the brand, model and size.')
      return
    }
    if (sending.current) return
    sending.current = true
    try {
      await add.mutateAsync({ id: id.current, description, qty: qty && qty > 0 ? qty : 1, unit: unit || null })
      toast({ title: 'Item added', body: `${rfqRef(rfq.number)} · ${description.trim()}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'item' }).message)
    } finally {
      sending.current = false
    }
  }

  return (
    <Dialog open busy={add.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Add an item"
        context={`${rfqRef(rfq.number)} · ${rfq.company.name}`}
        icon={Plus}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={add.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={add.isPending} busyLabel="Adding" onClick={() => void submit()}>
              Add item
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label="Description" requirement="required" error={error ?? undefined}>
            <TextField
              data-autofocus
              value={description}
              onChange={e => {
                setDescription(e.target.value)
                setError(null)
              }}
              placeholder="Endress+Hauser Cerabar PMC71, 0 to 10 bar"
              autoComplete="off"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity" source="Default">
              <NumberInput value={qty} onChange={setQty} min={0} />
            </Field>
            <Field label="Unit" requirement="optional">
              <TextField value={unit} onChange={e => setUnit(e.target.value)} placeholder="pcs" autoComplete="off" />
            </Field>
          </div>
          <button type="submit" className="sr-only" tabIndex={-1}>
            Add item
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
