import type { JobFacts } from '@/features/jobs/api'
import { useCancelledOrders, useJobInvoices } from '@/features/jobs/hooks'
import { useOrderEngineers, useOrderHeader, useOrderItems, useOrderLegs, useOrderMoney } from '@/features/orders/hooks'
import { useQuotations } from '@/features/quotations/hooks'
import { useOrderAttachments, useRfqAttachments, useRfqInquiries, useRfqItems } from '@/features/rfqs/hooks'

/*
 * Everything the job page's panels read, in one place: the same hooks the RFQ page and the order page use, on the same query keys,
 * so the reads the app starts before the page is drawn (prefetch.ts) are the ones the panels find. Money is read only for admin
 * and sales (the hooks' own `money` switch), and for an engineer no price is ever requested.
 */
export function useJobData(facts: JobFacts, role: 'admin' | 'sales' | 'engineer') {
  const { job } = facts
  const money = role !== 'engineer'
  const rfqId = job.rfqId ?? undefined
  const orderId = job.orderId ?? undefined
  const items = useRfqItems(rfqId)
  const inquiries = useRfqInquiries(rfqId)
  const quotations = useQuotations(money ? rfqId : undefined)
  const order = useOrderHeader(orderId, money)
  const orderItems = useOrderItems(orderId, money)
  const legs = useOrderLegs(orderId, orderItems.data)
  const engineers = useOrderEngineers(orderId)
  const orderMoney = useOrderMoney(orderId, role === 'engineer' ? null : role)
  const invoices = useJobInvoices(job.key, orderId, money)
  const cancelled = useCancelledOrders(job.key, rfqId, job.cancelledOrders)
  const rfqFiles = useRfqAttachments(rfqId)
  const orderFiles = useOrderAttachments(orderId)
  return { money, items, inquiries, quotations, order, orderItems, legs, engineers, orderMoney, invoices, cancelled, rfqFiles, orderFiles }
}

export type JobData = ReturnType<typeof useJobData>
