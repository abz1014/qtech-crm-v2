import { Skeleton } from '@/ui/Skeleton'
import type { JobSlotProps } from '@/features/jobs/slots'
import { CreateInvoiceButton, RecordPaymentButton } from '@/features/money/OrderMoneyButtons'
import { InvoicePdfButton } from '@/features/money/invoices/pdf/InvoicePdfButton'
import { CopyReminderButton } from '@/features/orders/CopyReminderButton'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'

/*
 * The Invoice stage of the job page (P5-D2). Admin and sales only; an engineer's stage says "Handled by the office" and draws nothing
 * here. Create invoice is offered only once the goods are delivered: while any supplier order is still on order the stage says so
 * instead of offering it. Then Print invoice, Record payment (admin) and the payment reminder (copied for WhatsApp), each the order
 * page's own button. None of them is green: the job page has one green button, the next step.
 */
export default function InvoiceWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId || !job.money) return null
  if (w.failed) return <p className="text-base text-fg-muted">The invoice details did not load. Open the order page to try again.</p>
  if (!w.ready || !w.order) return <Skeleton className="h-16 w-full" />
  const order = w.order
  const invoiced = order.state?.invoiced ?? 0
  const fully = order.state?.invoicing === 'fully_invoiced'
  const onOrder = w.goodsLegs.filter(l => l.deliveredOn === null).length
  const m = w.orderMoney.data
  const owing = invoiced > 0 && (m?.balance ?? 0) > 0
  return (
    <div className="grid gap-2" data-invoice-work>
      {order.cancelledOn === null && !fully ? (
        onOrder > 0 ? (
          <p className="text-base text-fg-2" data-slot="invoice-waits">
            {onOrder === 1 ? '1 supplier order is still on order.' : `${onOrder} supplier orders are still on order.`} Create the invoice once the goods are delivered.
          </p>
        ) : (
          <p>
            <CreateInvoiceButton orderId={order.id} />
          </p>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {invoiced > 0 ? <InvoicePdfButton orderId={order.id} size="sm" /> : null}
        {job.role === 'admin' && order.cancelledOn === null ? <RecordPaymentButton orderId={order.id} size="sm" /> : null}
        {owing ? <CopyReminderButton order={order} money={m} /> : null}
      </div>
    </div>
  )
}
