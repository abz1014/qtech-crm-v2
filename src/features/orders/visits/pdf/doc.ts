import { orderRef } from '@/lib/refs'
import type { OrderHeader, OrderItemRow } from '@/features/orders/api'
import { VISIT_TYPE_LABEL } from '@/features/orders/lib/visit'
import type { VisitRow } from '@/features/orders/visits/model'

/*
 * The service report of one visit: what the engineer hands the customer to sign. Plain data, no price (the items are the order's goods
 * lines with their quantities; serial numbers are not kept anywhere, so the column is left blank to write in).
 */
export interface ServiceReportDoc {
  orderRef: string
  /** "Installation", "Survey" or "Service". */
  visitType: string
  visitOn: string | null
  doneOn: string | null
  engineer: string | null
  customer: string
  siteName: string | null
  siteAddress: string | null
  contactName: string | null
  contactPhone: string | null
  customerPo: string | null
  /** The work done, as the engineer wrote it. */
  workDone: string | null
  items: Array<{ no: number; description: string; qty: number; unit: string | null }>
  printedOn: string
}

export function buildServiceReportDoc(order: OrderHeader, visit: VisitRow, items: readonly OrderItemRow[], printedOn: string): ServiceReportDoc {
  return {
    orderRef: orderRef(order.number),
    visitType: VISIT_TYPE_LABEL[visit.type],
    visitOn: visit.on,
    doneOn: visit.doneOn,
    engineer: visit.engineerName,
    customer: order.companyName,
    siteName: order.site?.name ?? null,
    siteAddress: order.site?.address ?? null,
    contactName: order.contact?.name ?? null,
    contactPhone: order.contact?.phone ?? null,
    customerPo: order.customerPo,
    workDone: visit.notes,
    items: items.filter(i => !i.isService).map((i, n) => ({ no: n + 1, description: i.description, qty: i.qty, unit: i.unit })),
    printedOn,
  }
}

/** "Service-report-ORD-0038-installation-2026-10-30.pdf" (the visit's date, else the day it was printed). */
export function serviceReportFileName(doc: ServiceReportDoc): string {
  return `Service-report-${doc.orderRef}-${doc.visitType.toLowerCase()}-${doc.doneOn ?? doc.visitOn ?? doc.printedOn}.pdf`
}
