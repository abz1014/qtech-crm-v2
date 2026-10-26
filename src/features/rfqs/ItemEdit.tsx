import { useRef, useState } from 'react'
import { Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useToast } from '@/ui/useToast'
import type { RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useRemoveRfqItem, useUpdateRfqItem } from '@/features/rfqs/hooks'
import { useEntryAccess } from '@/features/records/useEntryAccess'

/*
 * Edit and remove an RFQ item (W9). An item counts as the entering person's when the RFQ is theirs (0092 guard_entered_by), so
 * the whose-is-it rule reads the RFQ's creator and owner. Not theirs: the dialog opens with its fields disabled and says
 * "Entered by X: only they or an admin can change this". Removing an item an order line is based on is refused by the database
 * (HINT linked_to_order); the confirm shows that sentence and the item stays.
 */
export function ItemMenu({ rfq, item }: { rfq: RfqHeader; item: RfqItemRow }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="quiet" size="touch" icon={Ellipsis} aria-label={`More for item ${item.number}`} aria-haspopup="menu" />
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label={`More for item ${item.number}`}>
          <MenuItem icon={Pencil} onClick={() => setEditing(true)}>
            Edit item
          </MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => setRemoving(true)}>
            Remove item
          </MenuItem>
        </PopoverContent>
      </Popover>
      {editing ? <EditItemDialog rfq={rfq} item={item} onClose={() => setEditing(false)} /> : null}
      {removing ? <RemoveItemConfirm rfq={rfq} item={item} onClose={() => setRemoving(false)} /> : null}
    </>
  )
}

function useItemAccess(rfq: RfqHeader) {
  return useEntryAccess({ createdBy: rfq.createdBy ?? null, ownerId: rfq.owner?.id ?? null })
}

export function EditItemDialog({ rfq, item, onClose }: { rfq: RfqHeader; item: RfqItemRow; onClose: () => void }) {
  const { toast } = useToast()
  const save = useUpdateRfqItem(rfq.id)
  const access = useItemAccess(rfq)
  const sending = useRef(false)
  const [description, setDescription] = useState(item.description)
  const [qty, setQty] = useState<number | null>(item.qty)
  const [unit, setUnit] = useState(item.unit ?? '')
  const [error, setError] = useState<string | null>(null)
  const locked = !access.can
  const dirty = description.trim() !== item.description || qty !== item.qty || unit.trim() !== (item.unit ?? '')

  const submit = async () => {
    if (locked || sending.current) return
    if (description.trim() === '') {
      setError('Describe the item, for example the brand, model and size.')
      return
    }
    if (qty === null || qty <= 0) {
      setError('The quantity must be more than zero.')
      return
    }
    sending.current = true
    setError(null)
    try {
      await save.mutateAsync({ id: item.id, patch: { description, qty, unit: unit || null } })
      toast({ title: 'Item updated', body: `${rfqRef(rfq.number)} · item ${item.number}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'item' }).message)
    } finally {
      sending.current = false
    }
  }

  return (
    <Dialog open busy={save.isPending} dirty={dirty && !locked} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title={`Edit item ${item.number}`}
        context={`${rfqRef(rfq.number)} · ${rfq.company.name}`}
        icon={Pencil}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={save.isPending}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {locked ? null : (
              <Button variant="primary" busy={save.isPending} busyLabel="Saving" disabled={!dirty} onClick={() => void submit()}>
                Save item
              </Button>
            )}
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
          {locked && access.note ? (
            <p role="status" className="text-base font-medium text-fg-2" data-slot="not-yours">
              {access.note}
            </p>
          ) : null}
          <Field label="Description" requirement="required">
            <TextField
              data-autofocus
              value={description}
              disabled={locked}
              onChange={e => {
                setDescription(e.target.value)
                setError(null)
              }}
              autoComplete="off"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity">
              <NumberInput value={qty} onChange={setQty} min={0} disabled={locked} />
            </Field>
            <Field label="Unit" requirement="optional">
              <TextField value={unit} disabled={locked} onChange={e => setUnit(e.target.value)} placeholder="pcs" autoComplete="off" />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-base font-medium text-tone-danger-fg">
              {error}
            </p>
          ) : null}
          <button type="submit" className="sr-only" tabIndex={-1}>
            Submit
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveItemConfirm({ rfq, item, onClose }: { rfq: RfqHeader; item: RfqItemRow; onClose: () => void }) {
  const { toast } = useToast()
  const del = useRemoveRfqItem(rfq.id)
  const access = useItemAccess(rfq)
  return (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) onClose()
      }}
      thing={`item ${item.number}`}
      summary={`${rfqRef(rfq.number)} · ${item.description}`}
      also={['any supplier replies entered for it']}
      blocked={access.can ? null : access.note}
      onConfirm={async () => {
        await del.mutateAsync(item.id)
        toast({ title: `Item ${item.number} removed`, body: `${rfqRef(rfq.number)} · ${item.description}`, tone: 'success' })
      }}
      errorMessage={e => mapPgError(e, { entity: 'item' }).message}
    />
  )
}
