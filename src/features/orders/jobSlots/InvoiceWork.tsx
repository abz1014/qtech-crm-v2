import { Link } from 'react-router-dom'
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
  if (w.failed) return <p className="text-base text-fg-muted">The invoice details did not load. Reload the page to try again.</p>
  if (!w.ready || !w.order) return <Skeleton className="h-16 w-full" />
  const order = w.order
  const invoiced = order.state?.invoiced ?? 0
  const fully = order.state?.invoicing === 'fully_invoiced'
  const onOrder = w.goodsLegs.filter(l => l.deliveredOn === null).length
  const m = w.orderMoney.data
  const owing = invoiced > 0 && (m?.balance ?? 0) > 0
  // One main button (the first that applies); the others sit in the same line, quiet. None of them is green: the job page has one green button, the next step.
  const canCreate = order.cancelledOn === null && !fully && onOrder === 0
  const canPrint = invoiced > 0
  const canPay = job.role === 'admin' && order.cancelledOn === null
  const main = canCreate ? 'create' : canPay ? 'pay' : canPrint ? 'print' : owing ? 'remind' : null
  const look = (k: string) => (main === k ? 'secondary' : 'quiet') as 'secondary' | 'quiet'
  const buttons = [
    canCreate ? { key: 'create', node: <CreateInvoiceButton key="create" orderId={order.id} size="sm" variant={look('create')} /> } : null,
    canPrint ? { key: 'print', node: <InvoicePdfButton key="print" orderId={order.id} size="sm" variant={look('print')} /> } : null,
    canPay ? { key: 'pay', node: <RecordPaymentButton key="pay" orderId={order.id} size="sm" variant={look('pay')} /> } : null,
    owing ? { key: 'remind', node: <CopyReminderButton key="remind" order={order} money={m} variant={look('remind')} /> } : null,
  ].filter((b): b is { key: string; node: JSX.Element } => b !== null)
  return (
    <div className="grid gap-2" data-invoice-work>
      {order.cancelledOn === null && !fully ? (
        onOrder > 0 ? (
          <p className="type-body text-fg-2" data-slot="invoice-waits">
            {onOrder === 1 ? '1 supplier order is still on order.' : `${onOrder} supplier orders are still on order.`} Create the invoice once the goods are delivered.
          </p>
        ) : null
      ) : null}
      {/* 54-invoice-dialogs #job-print: the one outlined button first, the quiet ones after it, the register link last, all on one
          left edge: the quiet buttons and the link share the outlined button's inner padding, so their icons and words line up with
          its icon down a phone's column (they were staggered). */}
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2">
        {buttons.sort((a, b) => Number(b.key === main) - Number(a.key === main)).map(b => b.node)}
        {invoiced > 0 && job.role === 'admin' ? (
          <Link
            to={`/money/gst-register?q=${encodeURIComponent(`ORD-${String(order.number).padStart(4, '0')}`)}`}
            data-slot="invoice-register-link"
            className="inline-flex min-h-touch items-center rounded-control px-3 type-body font-medium text-primary underline-offset-4 hover:underline"
          >
            Open in Invoices to void one or issue a credit note
          </Link>
        ) : null}
      </div>
    </div>
  )
}
