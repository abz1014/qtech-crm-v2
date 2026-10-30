import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, rfqRef } from '@/lib/refs'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import * as api from '@/features/rfqs/api'
import { refreshAfterRfqDelete, useDeleteRfq, useRfqDeleteCounts } from '@/features/rfqs/hooks'
import { useOrdersForRfq } from '@/features/orders/forRfq'
import { alsoDeletes, NEEDS_ORDER_FIRST } from '@/features/rfqs/deleteFlow'

/* The delete-RFQ confirm (see deleteFlow.tsx): downloaded when an admin opens it, not with the RFQ page (perf: the page's LCP). */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function DeleteRfqConfirm({ rfq, onClose }: { rfq: { id: string; number: number; company: { name: string } }; onClose: () => void }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const del = useDeleteRfq()
  // The server refused with has_order although the page did not know of an order: blocked until the page is reloaded.
  const [refused, setRefused] = useState(false)
  const ref = rfqRef(rfq.number)

  const counts = useRfqDeleteCounts(rfq.id, true)
  const orders = useOrdersForRfq(rfq.id)
  const orderList = orders.data ?? []
  const loading = counts.isPending || orders.isPending

  let blocked: string | null = null
  if (orderList.length > 0) blocked = `Has order ${orderList.map(o => orderRef(o.number)).join(', ')}. ${NEEDS_ORDER_FIRST}`
  else if (refused) blocked = `Has an order. ${NEEDS_ORDER_FIRST}`

  const confirm = async () => {
    let files: api.StoredFile[]
    try {
      files = await del.mutateAsync(rfq.id)
    } catch (e) {
      if (mapPgError(e).hint === 'has_order') {
        setRefused(true)
        void orders.refetch()
      }
      throw e
    }
    // The rows are gone. Nothing below may throw into the confirm, or the person would be told the delete failed.
    const failed = await api.removeStoredFiles(files)
    navigate('/rfqs')
    void refreshAfterRfqDelete(client, rfq.id)
    toast({ title: `${ref} deleted`, body: rfq.company.name, tone: 'success' })
    if (failed.length > 0) {
      toast({
        title: 'Some files were not removed',
        body: `${plural(failed.length, 'file')} stayed in storage. ${ref} itself is deleted.`,
      })
    }
  }

  const hint = (e: unknown) => (mapPgError(e).hint === 'has_order' ? '' : mapPgError(e, { entity: 'RFQ' }).message)

  return (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) onClose()
      }}
      thing={ref}
      summary={`${ref} · ${rfq.company.name}`}
      also={counts.data && !blocked ? alsoDeletes(counts.data) : undefined}
      loading={loading && !blocked}
      blocked={blocked}
      onConfirm={confirm}
      errorMessage={hint}
    />
  )
}
