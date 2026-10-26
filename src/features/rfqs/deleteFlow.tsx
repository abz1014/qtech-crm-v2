import { Suspense, useState, type ReactNode } from 'react'
import { useSession } from '@/app/session'
import { lazyWithReload } from '@/lib/importWithReload'
import type * as api from '@/features/rfqs/api'
import { quotationRef } from '@/features/quotations/lib/refs'

// The confirm (ConfirmDelete, the counts, the delete itself) is downloaded when an admin opens it (perf: the RFQ page's LCP).
const DeleteRfqConfirm = lazyWithReload(() => import('@/features/rfqs/DeleteRfqConfirm'))

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
  const [open, setOpen] = useState(false)
  const node: ReactNode =
    isAdmin && open ? (
      <Suspense fallback={null}>
        <DeleteRfqConfirm rfq={rfq} onClose={() => setOpen(false)} />
      </Suspense>
    ) : null

  return {
    /** Admin only; undefined for everyone else, so the menu draws no item. */
    ask: isAdmin ? () => setOpen(true) : undefined,
    node,
  }
}
