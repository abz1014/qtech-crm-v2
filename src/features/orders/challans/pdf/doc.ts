import { orderRef } from '@/lib/refs'
import type { OrderHeader } from '@/features/orders/api'
import type { ChallanRow } from '@/features/orders/challans/model'

/* The delivery challan as the paper shows it. Items and quantities only: nothing here is, or can be, a price. */
export interface ChallanDoc {
  number: string
  issuedOn: string
  orderRef: string
  customer: string
  /** Where it goes: the delivery address that was typed or offered when the challan was made. */
  deliverTo: string | null
  contactName: string | null
  contactPhone: string | null
  customerPo: string | null
  notes: string | null
  lines: Array<{ no: number; description: string; qty: number; unit: string | null }>
}

export function buildChallanDoc(order: OrderHeader, challan: ChallanRow): ChallanDoc {
  return {
    number: challan.number,
    issuedOn: challan.issuedOn,
    orderRef: orderRef(order.number),
    customer: order.companyName,
    deliverTo: challan.deliverTo,
    contactName: order.contact?.name ?? null,
    contactPhone: order.contact?.phone ?? null,
    customerPo: order.customerPo,
    notes: challan.notes,
    lines: challan.lines.map((l, n) => ({ no: n + 1, description: l.description, qty: l.qty, unit: l.unit })),
  }
}

/** "Delivery-challan-DC-0007.pdf" */
export const challanFileName = (doc: Pick<ChallanDoc, 'number'>): string => `Delivery-challan-${doc.number}.pdf`
