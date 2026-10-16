import { expect, type Locator, type Page } from '@playwright/test'
import { createCompany, createRfq, karachiDay, must, review, rest, uniqueName } from '../support/stack'
import { waitForAnimationsToFinish } from '../support/axe'

/*
 * Shared by the O07 (supplier PO), O04 (orders list) and O02 (repeat order) specs: a tap counter, a few readers and the fixtures.
 * Every fixture makes its own customer and suppliers with unique names, so tests never collide.
 */

/** Counts every tap a person makes, so a test can assert the FE-2 number rather than just that something worked. */
export function tapper() {
  let taps = 0
  return {
    tap: async (target: Locator) => {
      await target.click()
      taps++
    },
    /** One intended tap that arrives twice (a double click): still one tap, and the test then proves it made one record. */
    doubleTap: async (target: Locator) => {
      await target.dblclick()
      taps++
    },
    /** Typing a value is an interaction too. */
    typed: async (target: Locator, value: string) => {
      await target.fill(value)
      taps++
    },
    get count() {
      return taps
    },
  }
}

export const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export const get = <T>(path: string) => must(rest<T[]>('admin', path))
export const legLoc = (page: Page, letter: string) => page.getByTestId(`leg-${letter}`)
export const shot = async (page: Page, name: string) => {
  await waitForAnimationsToFinish(page)
  await review(page, name)
}

export async function setProfile(complete: boolean): Promise<void> {
  await must(
    rest('admin', 'company_profile?id=eq.1', {
      method: 'PATCH',
      body: complete
        ? { legal_name: 'Q-Tech Solutions (Pvt) Ltd', address: 'Office 4, 2nd Floor, Gulberg III, Lahore 54660', phone: '+92 42 555 0138', ntn: '1234567-8', po_terms: '100% advance against proforma' }
        : { legal_name: null, address: null },
      prefer: 'return=minimal',
    }),
  )
}

export interface PoSeed {
  tag: string
  company: { id: string; name: string }
  supplier: { id: string; name: string }
  order: { id: string; number: number }
  /** The leg to issue: supplier in USD, four goods lines (order, last PO, quote, typed sources) and one service line. */
  leg: string
  items: { id: string; description: string }[]
  lastPoRef: string
}

/**
 * An order whose first leg (A) has four goods lines, one for each price source:
 *   line 1 has a supplier price on the order (612)      -> "order"
 *   line 2 is a model the supplier's last PO priced (742) -> "last PO"
 *   line 3 has the supplier's quote on its RFQ item (214) -> "quote"
 *   line 4 nothing knows a price                         -> "typed"
 * and the supplier has an earlier PO (to another order) that carries the incoterm and terms the new one starts from.
 */
export async function seedPo(opts: { allPriced?: boolean } = {}): Promise<PoSeed> {
  const tag = Math.random().toString(36).slice(2, 6)
  await setProfile(true)
  const company = await createCompany(uniqueName('Punjab Cement'))
  const supplier = await createCompany(uniqueName('Dubai Instrumentation'), { country: 'United Arab Emirates', city: 'Dubai' })
  await must(rest('admin', 'company_sites', { method: 'POST', body: { company_id: supplier.id, name: 'Jebel Ali office', address: 'Office 14, Block C, Jebel Ali Free Zone' }, prefer: 'return=minimal' }))
  await must(rest('admin', 'contacts', { method: 'POST', body: { company_id: supplier.id, name: 'Mr. Rashid Al Mansoori' }, prefer: 'return=minimal' }))

  // the earlier PO to this supplier (another order, another leg): its terms and its 742 price for the SITRANS controller
  const earlier = (await must(rest<{ id: string }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, ordered_on: karachiDay(-40) } })))[0]
  const earlierLeg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: earlier.id, supplier_id: supplier.id, currency: 'USD' } })))[0]
  const earlierItem = (
    await must(
      rest<{ id: string }[]>('admin', 'order_items', {
        method: 'POST',
        body: { order_id: earlier.id, position: 0, description: `Siemens SITRANS LUC500 level controller`, qty: 1, unit: 'ea', unit_price_net: 1000, supplier_order_id: earlierLeg.id, supplier_unit_price: 742 },
      }),
    )
  )[0]
  await must(
    rest('admin', 'rpc/issue_purchase_order', {
      method: 'POST',
      body: { p_po_id: crypto.randomUUID(), p_supplier_order_id: earlierLeg.id, p_lines: [{ order_item_id: earlierItem.id, unit_price: 742, qty: 1 }], p_incoterm: 'DAP', p_delivery_terms: 'Air freight, 3 weeks', p_payment_terms: 'Advance on order, balance before dispatch' },
    }),
  )
  const earlierPo = (await get<{ number: number; issued_on: string }>(`purchase_orders?supplier_order_id=eq.${earlierLeg.id}&select=number,issued_on`))[0]
  const lastPoRef = `PO-${earlierPo.issued_on.slice(2, 4)}-${String(earlierPo.number).padStart(4, '0')}`

  // the RFQ the supplier quoted on, so line 3 has a quote
  const rfq = await createRfq(company.id)
  const rfqItem = (await must(rest<{ id: string }[]>('admin', 'rfq_items', { method: 'POST', body: { rfq_id: rfq.id, description: `Memosens CPS11E pH sensor`, qty: 2 } })))[0]
  const inquiry = (await must(rest<{ id: string }[]>('admin', 'supplier_inquiries', { method: 'POST', body: { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: karachiDay(-20) } })))[0]
  await must(rest('admin', 'supplier_quote_lines', { method: 'POST', body: { inquiry_id: inquiry.id, rfq_item_id: rfqItem.id, unit_price: 214, currency: 'USD', lead_time: '2 wks' }, prefer: 'return=minimal' }))

  const order = (await must(rest<{ id: string; number: number }[]>('admin', 'orders', { method: 'POST', body: { company_id: company.id, ordered_on: karachiDay(-3), payment_terms_days: 30, customer_po_number: `PO-${tag.toUpperCase()}` } })))[0]
  const leg = (await must(rest<{ id: string }[]>('admin', 'supplier_orders', { method: 'POST', body: { order_id: order.id, supplier_id: supplier.id, currency: 'USD', inquiry_id: inquiry.id } })))[0]
  const items = await must(
    rest<{ id: string; description: string; position: number }[]>('admin', 'order_items', {
      method: 'POST',
      body: [
        { order_id: order.id, position: 0, description: `Endress+Hauser Cerabar PMC51 pressure transmitter`, qty: 3, unit: 'ea', unit_price_net: 187400, supplier_order_id: leg.id, supplier_unit_price: 612, rfq_item_id: null, is_service: false },
        { order_id: order.id, position: 1, description: `Siemens SITRANS LUC500 level controller`, qty: 2, unit: 'ea', unit_price_net: 214000, supplier_order_id: leg.id, supplier_unit_price: null, rfq_item_id: null, is_service: false },
        { order_id: order.id, position: 2, description: `Memosens CPS11E pH sensor`, qty: 2, unit: 'ea', unit_price_net: 96500, supplier_order_id: leg.id, supplier_unit_price: null, rfq_item_id: rfqItem.id, is_service: false },
        { order_id: order.id, position: 3, description: `M12 sensor cable set, 5 m`, qty: 8, unit: 'ea', unit_price_net: 4200, supplier_order_id: leg.id, supplier_unit_price: opts.allPriced ? 18.5 : null, rfq_item_id: null, is_service: false },
        { order_id: order.id, position: 4, description: `Commissioning and loop check`, qty: 1, unit: 'job', unit_price_net: 135000, supplier_order_id: null, supplier_unit_price: null, rfq_item_id: null, is_service: true },
      ],
    }),
  )
  items.sort((a, b) => a.position - b.position)
  return { tag, company, supplier, order, leg: leg.id, items, lastPoRef }
}

export { expect }
