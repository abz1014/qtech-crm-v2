import type { JobSlotProps } from '@/features/jobs/slots'
import { OrderPaymentLines } from '@/features/money/payments/PaymentCorrections'
import { useOrderWork } from '@/features/orders/jobSlots/useOrderWork'

/*
 * The Payment stage of the job page (P5-D2): the payments received, each with its menu (Correct, Void, Delete: the order page's own
 * OrderPaymentLines). Admin only: sales read the balance and never the payment rows, and an engineer sees "Handled by the office".
 */
export default function PaymentWork({ job }: JobSlotProps) {
  const w = useOrderWork(job)
  if (!w.orderId || job.role !== 'admin' || !w.order) return null
  return (
    <div className="grid gap-2" data-payment-work>
      <OrderPaymentLines orderId={w.order.id} orderNumber={w.order.number} />
    </div>
  )
}
