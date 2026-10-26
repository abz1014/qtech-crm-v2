import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, poRef } from '@/lib/refs'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import { removeStoredFiles } from '@/features/rfqs/api'
import { refreshAfterOrderDelete, useDeleteOrder, useOrderDeleteFacts } from '@/features/orders/hooks'
import type { OrderDeleteFacts, OrderHeader } from '@/features/orders/api'

/*
 * Delete an order (0092 delete_order; owner decision 2026-10-23: delete is permanent and admin only). One confirm
 * (src/ui/ConfirmDelete). Before the button is offered the confirm lists what blocks it, each in the words of what to do:
 *   "Has invoice INV-0042: delete it first."   "Has a payment recorded (a voided one counts): it is kept, so cancel the order."
 *   "Has an expense recorded: remove the expense first."   "Has issued PO PO-26-0017: issued POs are kept, so cancel the order."
 * Nothing blocking: it says what goes with the order ("Also deletes: 3 lines, 2 supplier orders, 1 file"). On success the stored
 * files the database named are removed (a file that will not go never undoes the delete), the person lands on the order list,
 * the lists, Today, the RFQ and the money refresh, then "ORD-0038 deleted".
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Everything that stops the delete, as sentences (empty when nothing does). */
export function orderBlockers(f: OrderDeleteFacts): string[] {
  const out: string[] = []
  for (const n of f.invoices) out.push(n ? `Has invoice ${n}: delete it first (Money, Invoices).` : 'Has an invoice with no number yet: delete it first (Money, Invoices).')
  if (f.payments > 0) out.push(`Has ${plural(f.payments, 'payment')} recorded (a voided one counts): payments are kept, so cancel the order instead.`)
  if (f.expenses > 0) out.push(`Has ${plural(f.expenses, 'expense')} recorded: remove ${f.expenses === 1 ? 'it' : 'them'} first, or keep the order.`)
  for (const p of f.pos) out.push(`Has issued PO ${poRef(p.number, p.issuedOn)}: issued POs are kept, so cancel the order instead.`)
  return out
}

/** What goes with the order, as the phrases for "Also deletes:". Empty counts are left out. */
export function orderAlsoDeletes(f: OrderDeleteFacts): string[] {
  return [
    f.lines > 0 ? plural(f.lines, 'line') : null,
    f.supplierOrders > 0 ? plural(f.supplierOrders, 'supplier order') : null,
    f.files > 0 ? plural(f.files, 'file') : null,
  ].filter((x): x is string => x !== null)
}

/** `to`: where the person lands after the delete (the order list; the job page passes the jobs list). */
export function useDeleteOrderFlow(order: Pick<OrderHeader, 'id' | 'number' | 'companyName'>, to = '/orders') {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const client = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const del = useDeleteOrder()
  const [open, setOpen] = useState(false)
  const ref = orderRef(order.number)
  const facts = useOrderDeleteFacts(order.id, isAdmin && open)

  const blockers = facts.data ? orderBlockers(facts.data) : []
  const blocked: ReactNode =
    blockers.length > 0 ? (
      <span className="grid gap-1" data-slot="delete-blockers">
        {blockers.map(b => (
          <span key={b}>{b}</span>
        ))}
      </span>
    ) : facts.isError ? (
      'Could not check what this order has. Reload the page and try again.'
    ) : null

  const confirm = async () => {
    const files = await del.mutateAsync(order.id)
    // The rows are gone. Nothing below may throw into the confirm, or the person would be told the delete failed.
    const failed = await removeStoredFiles(files)
    navigate(to)
    void refreshAfterOrderDelete(client, order.id)
    toast({ title: `${ref} deleted`, body: order.companyName, tone: 'success' })
    if (failed.length > 0) {
      toast({ title: 'Some files were not removed', body: `${plural(failed.length, 'file')} stayed in storage. ${ref} itself is deleted.` })
    }
  }

  const node: ReactNode =
    isAdmin && open ? (
      <ConfirmDelete
        open
        onOpenChange={o => {
          if (!o) setOpen(false)
        }}
        thing={ref}
        summary={`${ref} · ${order.companyName}`}
        also={facts.data && !blocked ? orderAlsoDeletes(facts.data) : undefined}
        loading={facts.isPending}
        blocked={blocked}
        onConfirm={confirm}
        errorMessage={e => mapPgError(e, { entity: 'order' }).message}
      />
    ) : null

  return {
    /** Admin only; undefined for everyone else, so the menu draws no item. */
    ask: isAdmin ? () => setOpen(true) : undefined,
    node,
  }
}
