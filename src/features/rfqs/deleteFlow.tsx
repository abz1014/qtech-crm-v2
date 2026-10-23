import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, rfqRef } from '@/lib/refs'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import * as api from '@/features/rfqs/api'
import { refreshAfterRfqDelete, useDeleteRfq, useRfqDeleteCounts } from '@/features/rfqs/hooks'
import { useOrdersForRfq } from '@/features/orders/hooks'
import { quotationRef } from '@/features/quotations/lib/refs'

/*
 * Delete an RFQ (0092 delete_rfq; owner decision 2026-10-23: an RFQ entered by mistake can go). Admin only: the menu item is not
 * drawn for anyone else, and the database refuses them anyway. One confirm (src/ui/ConfirmDelete) that first reads what goes with
 * the RFQ and says so; an RFQ with an order cannot be deleted, so the confirm says which order instead of offering Delete.
 * On success: the stored files the database named are removed (a file that will not go never undoes the delete: it is logged and
 * a quiet note says so), the page is left for the RFQ list, then the lists, Today and the nav counts refresh, then "RFQ-0177 deleted".
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "2 issued quotations (QT-26-0012 R0, R1)": the numbers once, then the revisions. */
export function quotationsPhrase(qs: api.RfqDeleteCounts['quotations']): string {
  const byNumber = new Map<number, { issuedOn: string; revisions: number[] }>()
  for (const q of qs) {
    const g = byNumber.get(q.number) ?? { issuedOn: q.issuedOn, revisions: [] }
    g.revisions.push(q.revision)
    byNumber.set(q.number, g)
  }
  const named = [...byNumber].map(
    ([n, g]) =>
      `${quotationRef(n, g.issuedOn, g.revisions[0])}${g.revisions
        .slice(1)
        .map(r => `, R${r}`)
        .join('')}`,
  )
  return `${plural(qs.length, 'issued quotation')} (${named.join('; ')})`
}

/** What else goes with the RFQ, as the phrases for "Also deletes:". Empty counts are left out. */
export function alsoDeletes(c: api.RfqDeleteCounts): string[] {
  return [
    c.quotations.length > 0 ? quotationsPhrase(c.quotations) : null,
    c.items > 0 ? plural(c.items, 'item') : null,
    c.supplierPrices > 0 ? plural(c.supplierPrices, 'supplier price') : null,
    c.files > 0 ? plural(c.files, 'file') : null,
  ].filter((x): x is string => x !== null)
}

export const NEEDS_ORDER_FIRST = 'Delete or cancel the order first.'

export function useDeleteRfqFlow(rfq: { id: string; number: number; company: { name: string } }) {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const client = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const del = useDeleteRfq()
  const [open, setOpen] = useState(false)
  // The server refused with has_order although the page did not know of an order: blocked until the page is reloaded.
  const [refused, setRefused] = useState(false)
  const ref = rfqRef(rfq.number)

  const counts = useRfqDeleteCounts(rfq.id, isAdmin && open)
  const orders = useOrdersForRfq(isAdmin && open ? rfq.id : undefined)
  const orderList = orders.data ?? []
  const loading = counts.isPending || orders.isPending

  let blocked: ReactNode = null
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

  const node: ReactNode =
    isAdmin && open ? (
      <ConfirmDelete
        open
        onOpenChange={o => {
          if (!o) setOpen(false)
        }}
        thing={ref}
        summary={`${ref} · ${rfq.company.name}`}
        also={counts.data && !blocked ? alsoDeletes(counts.data) : undefined}
        loading={loading && !blocked}
        blocked={blocked}
        onConfirm={confirm}
        errorMessage={hint}
      />
    ) : null

  return {
    /** Admin only; undefined for everyone else, so the menu draws no item. */
    ask: isAdmin
      ? () => {
          setRefused(false)
          setOpen(true)
        }
      : undefined,
    node,
  }
}
