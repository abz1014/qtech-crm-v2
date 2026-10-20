import { OrderPaymentLines } from '@/features/money/payments/PaymentCorrections'
import { useOrderPayments } from '@/features/money/payments/correctionHooks'

/*
 * The money panels of the order page (g2-order-detail.html): "Margin" (admin only, M04), and under it "Invoices and payments" (admin
 * only): the order's payments, each with ⋯ Correct… / Void… (0073), the voided ones folded with Undo. They live with the other money
 * code because they read order_costs, expenses, payments_in and v_order_money.
 *
 * The figures (invoiced, received, balance, due date) and Print invoice stay in the header's status strip (UX audit 2026-10-19,
 * screens.md 8): this panel is where a recorded payment is put right.
 */
export { MarginPanel } from '@/features/money/costs/MarginPanel'

export function InvoicesPanel({ orderId, orderNumber }: { orderId: string; orderNumber: number }) {
  // Only once a payment is recorded: before that there is nothing to put right, and the strip already says "Nothing received yet".
  const q = useOrderPayments(orderId)
  if (!q.data?.length) return null
  return (
    <section id="payments" aria-label="Invoices and payments" data-slot="invoices-payments" className="rounded border bg-surface">
      <div className="flex items-center gap-2 border-b px-4 py-3 md:px-5">
        <h2 className="text-base font-semibold">Invoices and payments</h2>
        <span className="ml-auto text-xs text-fg-muted">Payments received</span>
      </div>
      <div className="grid gap-2 px-4 py-3 md:px-5">
        <OrderPaymentLines orderId={orderId} orderNumber={orderNumber} />
      </div>
    </section>
  )
}
