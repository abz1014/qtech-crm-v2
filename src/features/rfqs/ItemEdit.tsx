import { useState } from 'react'
import { Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { lazyShown } from '@/lib/lazyDialog'
import { Button } from '@/ui/Button'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import type { RfqHeader, RfqItemRow } from '@/features/rfqs/api'

/*
 * Edit and remove an RFQ item (W9). An item counts as the entering person's when the RFQ is theirs (0092 guard_entered_by), so
 * the whose-is-it rule reads the RFQ's creator and owner. Not theirs: the dialog opens with its fields disabled and says
 * "Entered by X: only they or an admin can change this". Removing an item an order line is based on is refused by the database
 * (HINT linked_to_order); the confirm shows that sentence and the item stays.
 */
// Downloaded when opened, not with the RFQ page (perf: its LCP).
const EditItemDialog = lazyShown(() => import('@/features/rfqs/ItemDialogs').then(m => m.EditItemDialog))
const RemoveItemConfirm = lazyShown(() => import('@/features/rfqs/ItemDialogs').then(m => m.RemoveItemConfirm))

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

