import { parseLegacyDate } from '../lib/dates'
import { legacyId } from '../lib/ids'
import { clean, money, num, str } from '../lib/text'
import type { Row } from '../lib/text'
import { normPo } from '../mappings'
import type { NewRow } from '../types'
import type { CompanyBook, CustomerRef } from './companies'
import type { Ctx } from './context'
import type { Ledger } from './ledger'

// I04: orders -> orders, items, legs, order_costs, order_engineers. Basis resolution against the GST register.
// PO 000001 Unit A and Unit B are merged into one order (owner decision); other PO clashes follow po_clashes.csv.

export interface OrderGroup {
  newId: string
  oldIds: string[]
  poNumber: string | null
  ownerId: string | null
  flags: Set<string>
  itemsNet: number
  legs: { id: string; supplierId: string }[]
}

export interface OrderOutput {
  orders: NewRow[]
  supplier_orders: NewRow[]
  order_items: NewRow[]
  order_costs: NewRow[]
  order_engineers: NewRow[]
  /** old order id -> the group (new order) it went into */
  byOldId: Map<string, OrderGroup>
  groups: OrderGroup[]
}

const DELIVERED = new Set(['delivered', 'payment_received', 'completed'])
const PROCUREMENT = new Set(['procurement', 'in_transit'])
const INVENTORY = /inventory|procurement/i

interface Prep {
  r: Row
  oldId: string
  ref: CustomerRef
  ordered: string | null
  po: string | null
  poKey: string
  value: number
  cost: number
}

/** "Wallmount Ultrasonic Flow Meter x1 — Unit A", from the old notes ("PO# ... (Unit A). Wallmount ... x1. Received & delivered."). */
export function itemDescription(r: Row): string {
  const notes = str(r, 'notes')
  const type = str(r, 'product_type')
  let text: string | null = null
  let unit: string | null = null
  if (notes !== null) {
    const m = /\(\s*((?:unit|batch)\s+[a-z0-9]+)\s*\)/i.exec(notes) ?? /\b(unit\s+[a-z])\b/i.exec(notes)
    if (m) unit = m[1]!.replace(/^(unit|batch)/i, w => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).replace(/\s+/g, ' ')
    const sentences = notes
      .split(/\.\s+|\.$/)
      .map(s => s.trim())
      .filter(Boolean)
    // A bare "Batch A" / "Unit B" sentence is a label, not the product.
    const label = sentences.find(s => /^(unit|batch)\s+[a-z0-9]+$/i.test(s))
    if (label && !unit) unit = label.replace(/^(unit|batch)/i, w => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    text =
      sentences.find(
        s => !/^PO\s*#/i.test(s) && !/^(unit|batch)\s+[a-z0-9]+$/i.test(s) && !/^(received|delivered|net margin|final remaining|remaining|payment)/i.test(s),
      ) ?? null
  }
  const base = (text ?? type ?? 'Legacy order').slice(0, 200)
  return unit ? `${base} — ${unit}` : base
}

export function transformOrders(
  ctx: Ctx,
  book: CompanyBook,
  rfqIds: Map<string, string>,
  rfqRefs: Map<string, CustomerRef>,
  ledger: Ledger,
): OrderOutput {
  const preps: Prep[] = []
  const byRfqConverted = new Map<string, string>() // old order id -> old rfq id (from rfqs.converted_order_id)
  for (const r of ctx.rows('rfqs')) {
    const oid = str(r, 'converted_order_id')
    if (oid !== null) byRfqConverted.set(oid, String(r['id']))
  }

  for (const r of ctx.rows('orders')) {
    const oldId = String(r['id'])
    const value = num(r['order_value']) ?? 0
    ledger.add('orderValue', 'old', value)
    let ref: CustomerRef | null = null
    const clientId = str(r, 'client_id')
    if (clientId !== null && book.clients.has(clientId)) ref = book.clients.get(clientId)!
    else {
      const rfqOld = str(r, 'rfq_id') ?? byRfqConverted.get(oldId) ?? null
      if (rfqOld !== null && rfqRefs.has(rfqOld)) ref = rfqRefs.get(rfqOld)!
    }
    if (ref === null) {
      ctx.drop('orders', oldId, str(r, 'notes') ?? oldId, 'no client (and no RFQ to take the company from)')
      ledger.add('orderValue', 'excluded', value)
      continue
    }
    const po = str(r, 'customer_po_number')
    const poDate = parseLegacyDate(r['customer_po_date'])
    const confirmed = parseLegacyDate(r['confirmed_date'])
    for (const [col, p] of [['customer_po_date', poDate], ['confirmed_date', confirmed]] as const) {
      if (p.status === 'invalid') {
        ctx.addReview('unparseable_dates', 'orders', oldId, po ?? oldId, `${col} = "${String(r[col])}"`)
      }
    }
    preps.push({
      r,
      oldId,
      ref,
      ordered: poDate.date ?? confirmed.date,
      po,
      poKey: normPo(po),
      value,
      cost: num(r['cost_value']) ?? 0,
    })
  }

  // ------------------------------------------------------------------ group by (company, PO number)
  const byPo = new Map<string, Prep[]>()
  for (const p of preps) {
    if (p.poKey === '') continue
    const k = `${p.ref.companyId}|${p.poKey}`
    byPo.set(k, [...(byPo.get(k) ?? []), p])
  }
  const grouped = new Map<string, Prep[]>() // rep old id -> members
  const sharedPo = new Set<string>()
  const memberOf = new Map<string, string>()
  const earliest = (xs: Prep[]) => [...xs].sort((a, b) => (a.ordered ?? '9999').localeCompare(b.ordered ?? '9999') || a.oldId.localeCompare(b.oldId))
  for (const members of byPo.values()) {
    if (members.length < 2) continue
    const decision = ctx.maps.poDecisions.get(members[0]!.poKey)
    const names = members.map(m => m.oldId).join(', ')
    if (decision === 'merge') {
      const sorted = earliest(members)
      grouped.set(sorted[0]!.oldId, sorted)
      for (const m of sorted) memberOf.set(m.oldId, sorted[0]!.oldId)
      ctx.addReview('po_clashes', 'orders', sorted[0]!.oldId, members[0]!.po ?? '', `merged into one order (orders ${names}); decided`)
    } else {
      for (const m of members) sharedPo.add(m.oldId)
      ctx.addReview(
        'po_clashes',
        'orders',
        members[0]!.oldId,
        members[0]!.po ?? '',
        decision === 'po_shared'
          ? `kept separate with flag po_shared (orders ${names}); decided`
          : `UNDECIDED: orders ${names} share this PO number. Kept separate with flag po_shared. Add a row to po_clashes.csv: merge or po_shared.`,
      )
    }
  }

  const gstByOrder = new Map<string, Row[]>()
  for (const g of ctx.rows('gst_invoices')) {
    const k = str(g, 'order_id')
    if (k !== null) gstByOrder.set(k, [...(gstByOrder.get(k) ?? []), g])
  }
  const paymentsByOrder = new Map<string, number>()
  for (const p of ctx.rows('order_payments')) {
    const k = str(p, 'order_id')
    if (k !== null) paymentsByOrder.set(k, (paymentsByOrder.get(k) ?? 0) + 1)
  }
  const supplierPayByOrder = new Set(ctx.rows('supplier_payments').map(p => str(p, 'order_id')).filter((x): x is string => x !== null))
  const inventoryExpenseByOrder = new Set(
    ctx
      .rows('expenses')
      .filter(e => INVENTORY.test(str(e, 'category') ?? ''))
      .map(e => str(e, 'order_id'))
      .filter((x): x is string => x !== null),
  )
  const engineersByOrder = new Map<string, Row[]>()
  for (const e of ctx.rows('order_engineers')) {
    const k = str(e, 'order_id')
    if (k !== null) engineersByOrder.set(k, [...(engineersByOrder.get(k) ?? []), e])
  }

  const out: OrderOutput = {
    orders: [],
    supplier_orders: [],
    order_items: [],
    order_costs: [],
    order_engineers: [],
    byOldId: new Map(),
    groups: [],
  }

  const done = new Set<string>()
  for (const prep of preps) {
    const repOld = memberOf.get(prep.oldId) ?? prep.oldId
    if (done.has(repOld)) continue
    done.add(repOld)
    const members = grouped.get(repOld) ?? [prep]
    const rep = members[0]!
    const merged = members.length > 1
    const flags = new Set<string>()
    if (merged) flags.add('merged_orders')
    if (members.some(m => sharedPo.has(m.oldId))) flags.add('po_shared')

    const id = legacyId('order', rep.oldId)
    const memberIds = members.map(m => m.oldId)

    // ---------------------------------------------------------------- owner and dates
    const ownerFlags: string[] = []
    const ownerId = ctx.ownerFields(rep.r['sales_person_id'], ownerFlags)
    ownerFlags.forEach(f => flags.add(f))
    const orderedOn = members.map(m => m.ordered).filter((d): d is string => d !== null).sort()[0] ?? null
    if (orderedOn === null) flags.add('undated')
    const bestDate = orderedOn ?? parseLegacyDate(rep.r['created_at']).date ?? ctx.opts.asOf

    // ---------------------------------------------------------------- items
    const legs = new Map<string, { id: string; supplierId: string; placed: string[]; expected: string[]; delivered: string[]; allDelivered: boolean }>()
    let itemsNet = 0
    members.forEach((m, i) => {
      const status = (str(m.r, 'status') ?? 'po_received').toLowerCase()
      const delivered = DELIVERED.has(status)

      // leg (one per distinct supplier on the order)
      const vendorId = str(m.r, 'vendor_id')
      const supplier = vendorId !== null ? book.vendors.get(vendorId) : undefined
      let legId: string | null = null
      if (supplier) {
        let leg = legs.get(supplier)
        if (!leg) {
          leg = { id: legacyId('supplier_order', `${rep.oldId}|${supplier}`), supplierId: supplier, placed: [], expected: [], delivered: [], allDelivered: true }
          legs.set(supplier, leg)
        }
        legId = leg.id
        const dd = parseLegacyDate(m.r['delivery_date'])
        if (dd.status === 'invalid') ctx.addReview('unparseable_dates', 'orders', m.oldId, m.po ?? m.oldId, `delivery_date = "${String(m.r['delivery_date'])}"`)
        const mDate = m.ordered ?? bestDate
        if (delivered) {
          leg.placed.push(mDate)
          leg.delivered.push(dd.date ?? mDate)
          if (dd.date === null) flags.add('dates_estimated')
          flags.add('dates_estimated')
        } else {
          leg.allDelivered = false
          if (PROCUREMENT.has(status)) {
            leg.placed.push(mDate)
            flags.add('dates_estimated')
          }
          if (dd.date !== null) leg.expected.push(dd.date)
        }
      }

      const price = m.value
      itemsNet = money(itemsNet + price)
      ledger.add('orderValue', 'neu', price)
      out.order_items.push({
        id: legacyId('order_item', m.oldId),
        order_id: id,
        position: i,
        description: itemDescription(m.r),
        brand_id: null,
        family_id: book.family(str(m.r, 'product_type')),
        qty: 1,
        unit: null,
        unit_price_net: price,
        gst_rate: 18,
        is_service: false,
        supplier_order_id: legId,
        rfq_item_id: null,
        supplier_unit_price: null,
        legacy_flags: [],
        legacy_source: { table: 'orders', row: m.r },
      })

      // status/payment disagreement, margin anomaly, double counts: flagged on the order, never fixed silently
      if (status === 'payment_received' && !(paymentsByOrder.get(m.oldId) ?? 0)) flags.add('paid_per_status_no_payment_rows')
      if (m.value > 0 && m.cost >= m.value * 0.95) {
        flags.add('margin_anomaly')
        ctx.addReview('margin_anomalies', 'orders', m.oldId, m.po ?? itemDescription(m.r), `sale ${m.value}, cost ${m.cost}`)
      }
      if (supplierPayByOrder.has(m.oldId) && inventoryExpenseByOrder.has(m.oldId)) {
        flags.add('cost_possible_double_count')
        ctx.addReview(
          'cost_double_counts',
          'orders',
          m.oldId,
          m.po ?? itemDescription(m.r),
          'has both supplier payments and an Inventory/Procurement expense: the same cost may be counted twice',
        )
      }
    })

    // ---------------------------------------------------------------- legs
    const outLegs: { id: string; supplierId: string }[] = []
    for (const leg of [...legs.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const deliveredOn = leg.allDelivered && leg.delivered.length ? [...leg.delivered].sort().at(-1)! : null
      out.supplier_orders.push({
        id: leg.id,
        order_id: id,
        supplier_id: leg.supplierId,
        placed_on: leg.placed.length ? [...leg.placed].sort()[0]! : null,
        expected_on: deliveredOn === null && leg.expected.length ? [...leg.expected].sort().at(-1)! : null,
        // Owner decision (2026-10-15): there is no Received step. Received is the delivered date.
        received_on: deliveredOn,
        delivered_on: deliveredOn,
        legacy_flags: flags.has('dates_estimated') ? ['dates_estimated'] : [],
        legacy_source: { table: 'orders', rows: members.map(m => m.r) },
      })
      outLegs.push({ id: leg.id, supplierId: leg.supplierId })
    }

    // ---------------------------------------------------------------- basis resolution against the GST register
    const gstRows = memberIds.flatMap(k => gstByOrder.get(k) ?? [])
    // gst_invoices.amount includes GST (the old register's "Amount (incl GST)"); net = amount - gst_amount.
    const gstGross = money(gstRows.reduce((s, g) => s + (num(g['amount']) ?? 0), 0))
    const gstTax = money(gstRows.reduce((s, g) => s + (num(g['gst_amount']) ?? 0), 0))
    const gstNet = money(gstGross - gstTax)
    const valueSum = money(members.reduce((s, m) => s + m.value, 0))
    if (gstRows.length > 0 && Math.abs(gstNet - valueSum) <= 1) {
      // The invoice proves order_value is net: nothing to flag.
    } else {
      flags.add('value_basis_unknown')
      const hint =
        gstRows.length === 0
          ? 'no GST invoice to prove it'
          : Math.abs(gstGross - valueSum) <= 1
            ? 'the GST invoice suggests the old value is GROSS (the invoice amount including GST equals it)'
            : `the GST invoice (net ${gstNet}, GST ${gstTax}) matches neither`
      ctx.addReview('basis_unknown', 'orders', rep.oldId, rep.po ?? itemDescription(rep.r), `old order value ${valueSum}: ${hint}. Never converted by the import; the admin resolves it per order.`)
    }

    // ---------------------------------------------------------------- engineers and commissioning
    const engs = memberIds.flatMap(k => engineersByOrder.get(k) ?? [])
    let planned: string | null = null
    let doneOn: string | null = null
    if (engs.length) {
      const starts = engs.map(e => parseLegacyDate(e['start_date'])).filter(p => p.date !== null).map(p => p.date!)
      planned = starts.sort()[0] ?? null
      if (engs.every(e => (str(e, 'commissioning_status') ?? '') === 'completed')) {
        const ends = engs.map(e => parseLegacyDate(e['expected_completion'])).filter(p => p.date !== null).map(p => p.date!)
        doneOn = ends.sort().at(-1) ?? null
        if (doneOn !== null) flags.add('dates_estimated')
      }
      for (const e of engs) {
        for (const col of ['start_date', 'expected_completion'] as const) {
          if (parseLegacyDate(e[col]).status === 'invalid') {
            ctx.addReview('unparseable_dates', 'order_engineers', String(e['id']), rep.po ?? rep.oldId, `${col} = "${String(e[col])}"`)
          }
        }
        const u = ctx.owner(e['engineer_id'])
        if (u.userId === null) {
          ctx.drop('order_engineers', String(e['id']), rep.po ?? rep.oldId, 'engineer is not a user in the new project')
          continue
        }
        if (!out.order_engineers.some(x => x['order_id'] === id && x['user_id'] === u.userId)) {
          out.order_engineers.push({ order_id: id, user_id: u.userId })
        }
      }
    }

    // ---------------------------------------------------------------- order, cost
    const cost = money(members.reduce((s, m) => s + m.cost, 0))
    if (cost > 0) out.order_costs.push({ order_id: id, expected_cost_pkr: cost })

    const rfqOld = members.map(m => str(m.r, 'rfq_id') ?? byRfqConverted.get(m.oldId) ?? null).find(x => x !== null) ?? null
    const rfqNew = rfqOld !== null ? (rfqIds.get(rfqOld) ?? null) : null
    const termsDays = members.map(m => num(m.r['payment_terms_days'])).find(x => x !== null) ?? null
    const stamp = clean(rep.r['created_at'])

    out.orders.push({
      id,
      ...(stamp !== null && parseLegacyDate(stamp).status === 'ok' ? { created_at: stamp } : {}),
      company_id: rep.ref.companyId,
      site_id: rep.ref.siteId,
      contact_id: null,
      rfq_id: rfqNew,
      owner_id: ownerId,
      customer_po_number: rep.po,
      ordered_on: orderedOn,
      payment_terms_days: termsDays !== null && termsDays >= 0 ? Math.round(termsDays) : null,
      needs_commissioning: engs.length > 0,
      commissioning_planned_on: planned,
      commissioning_done_on: doneOn,
      notes: members.map(m => str(m.r, 'notes')).filter((x): x is string => x !== null).join('\n---\n') || null,
      legacy_flags: [...flags].sort(),
      legacy_source: merged ? { table: 'orders', rows: members.map(m => m.r) } : { table: 'orders', row: rep.r },
    })

    const group: OrderGroup = { newId: id, oldIds: memberIds, poNumber: rep.po, ownerId, flags, itemsNet, legs: outLegs }
    out.groups.push(group)
    for (const k of memberIds) out.byOldId.set(k, group)
  }
  return out
}
