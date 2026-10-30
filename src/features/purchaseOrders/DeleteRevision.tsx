import { mapPgError } from '@/lib/pgErrors'
import { poRef } from '@/lib/refs'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import { useDeletePoRevision } from '@/features/purchaseOrders/hooks'

/*
 * Delete the latest revision of a PO (W12a, 0092 delete_po_revision; admin only; an older revision cannot be deleted, a PO is
 * "revise only"). The prices the revision wrote onto the order's lines stay as they are: the confirm says so. The PDF is removed
 * from storage afterwards, and a file that will not go never undoes the delete.
 */
export function DeletePoRevisionConfirm({
  orderId,
  po,
  supplierName,
  onClose,
}: {
  orderId: string
  po: { id: string; number: number; revision: number; firstIssuedOn: string }
  supplierName: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const del = useDeletePoRevision(orderId)
  const ref = `${poRef(po.number, po.firstIssuedOn)} R${po.revision}`
  return (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) onClose()
      }}
      thing={ref}
      summary={`${ref} · ${supplierName}. Supplier prices it already wrote onto the order's lines stay as they are.`}
      also={['its PDF']}
      onConfirm={async () => {
        await del.mutateAsync(po.id)
        toast({ title: `${ref} deleted`, body: supplierName, tone: 'success' })
      }}
      errorMessage={e => mapPgError(e, { entity: 'PO' }).message}
    />
  )
}
