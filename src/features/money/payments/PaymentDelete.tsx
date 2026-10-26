import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { deleteBlockedBy, type DeleteBlock, type PaymentLine } from '@/features/money/payments/correctionApi'
import { useDeletePayment } from '@/features/money/payments/correctionHooks'

/*
 * Delete a payment (0092 delete_payment; owner decisions 2026-10-23: permanent and admin only, "alongside Correct and Void" for a
 * payment that was a mistake; a locked month must be reopened first). Offered from the payment's menu, which only an admin gets.
 * One confirm (src/ui/ConfirmDelete). The three refusals the database gives, with their hints, are known before the tap and said in
 * the confirm instead of Delete (the server's same sentence still shows if one arrives anyway):
 *   voided            kept as history (void is how a payment is taken out; it cannot be deleted)
 *   correction_chain  part of a correction, kept as history
 *   bank_ticked       ticked against a bank statement: untick it in Match bank statement, then delete
 */
export const DELETE_BLOCK_TEXT: Record<Exclude<DeleteBlock, 'bank_ticked'>, string> = {
  voided: 'This payment is voided and kept as history. It cannot be deleted.',
  correction_chain: 'This payment is part of a correction, so it is kept as history. It cannot be deleted.',
}

export function paymentBlockedNode(block: DeleteBlock, line: Pick<PaymentLine, 'bankMonth'>): ReactNode {
  if (block === 'bank_ticked') {
    const month = (line.bankMonth ?? '').slice(0, 7)
    return (
      <>
        This payment is ticked against the {month ? monthKeyLabel(month) : ''} bank statement. Untick it first, then delete it.{' '}
        <Link to={month ? `/money/month-end/bank?month=${month}` : '/money/month-end/bank'} className="font-medium text-primary underline">
          Open Match bank statement
        </Link>
      </>
    )
  }
  return DELETE_BLOCK_TEXT[block]
}

export function useDeletePaymentFlow(line: PaymentLine, orderNumber: number, inChain: boolean) {
  const del = useDeletePayment(line.orderId)
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  // The server refused with a hint this page did not know of (ticked or corrected since it was opened).
  const [refused, setRefused] = useState<DeleteBlock | null>(null)
  const block = deleteBlockedBy(line, inChain) ?? refused
  const today = businessToday()

  const confirm = async () => {
    try {
      await del.mutateAsync(line.id)
    } catch (e) {
      const hint = mapPgError(e).hint
      if (hint === 'bank_ticked' || hint === 'correction_chain' || hint === 'voided') setRefused(hint)
      throw e
    }
    toast({ title: 'Deleted payment', body: `${orderRef(orderNumber)} · PKR ${formatAmount(line.amount)} · ${formatShortDate(line.receivedOn, today)}`, tone: 'success' })
  }

  const node: ReactNode = open ? (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) setOpen(false)
      }}
      thing="this payment"
      summary={
        <span data-testid="delete-payment-what">
          {orderRef(orderNumber)} · PKR {formatAmount(line.amount)} · {formatShortDate(line.receivedOn, today, true)}
        </span>
      }
      blocked={block ? paymentBlockedNode(block, line) : null}
      onConfirm={confirm}
      errorMessage={e => mapPgError(e, { entity: 'payment' }).message.replace(/An admin can reopen it\.?$/, 'Reopen it on Month end first.')}
    />
  ) : null

  return { ask: () => setOpen(true), node, block }
}
